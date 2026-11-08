import { modelCost, validUsage } from './budget';
import { ExactModelCache } from './cache';
import { parseRoutingConfig } from './config';
import {
  ModelExecutionError,
  type ModelBudgetPort,
  type ModelCachePort,
  type ModelCapability,
  type ModelExecution,
  type ModelJob,
  type ModelResult,
  type ModelUsage,
  type ModelWorkload,
  type RoutingConfig,
} from './contracts';
import { canonicalJson, digest, freezeJson } from './data';
import { z } from 'zod';
import { WORKLOADS } from './contracts';

const jobSchema = z
  .object({
    workload: z.enum(WORKLOADS),
    input: z.unknown(),
    prefix: z.string().max(32_000),
    promptVersion: z.string().min(1).max(100),
    validationVersion: z.string().min(1).max(100),
    privacy: z.enum(['local-only', 'remote-allowed']),
    audience: z.string().min(1).max(100),
    cache: z
      .object({ revision: z.string().min(1).max(200), ttlMs: z.number().positive().max(3_600_000) })
      .strict()
      .optional(),
  })
  .strict();

const capabilities: Record<ModelWorkload, ModelCapability[]> = {
  decision: ['text', 'json'],
  classification: ['text', 'json'],
  summary: ['text'],
  reflection: ['text'],
  embedding: ['embedding'],
  vision: ['vision'],
  code: ['text', 'code'],
};
const cacheable = new Set<ModelWorkload>(['embedding', 'classification', 'summary']);

/** Policy-driven dispatch. Providers execute proposals; this port grants no world/tool permissions. */
export class WorkloadRouter {
  private readonly config: RoutingConfig;
  private readonly cache: ModelCachePort;
  private readonly health = new Map<
    string,
    { failures: number; until: number; latency?: number }
  >();
  private readonly warm = new Map<string, number>();
  private readonly pending = new Map<string, Promise<ModelResult<unknown>>>();
  private readonly counters = { attempts: 0, resultCacheHits: 0, coalesced: 0, failures: 0 };
  private active = 0;
  constructor(
    config: RoutingConfig,
    private readonly budget: ModelBudgetPort,
    private readonly now: () => number = Date.now,
    cache?: ModelCachePort,
  ) {
    this.config = parseRoutingConfig(config);
    for (const profile of this.config.profiles) {
      Object.freeze(profile.capabilities);
      Object.freeze(profile.rates);
      Object.freeze(profile);
    }
    this.cache = cache ?? new ExactModelCache(now);
  }
  stats() {
    return { ...this.counters };
  }
  async run<T>(
    job: ModelJob,
    execute: (execution: ModelExecution) => Promise<{ value: unknown; usage?: ModelUsage }>,
    validate: (value: unknown) => T,
  ): Promise<ModelResult<T>> {
    if (!jobSchema.safeParse(job).success) throw new Error('Invalid model job contract.');
    job = freezeJson(JSON.parse(canonicalJson(job)) as ModelJob);
    const policy = this.config.policies[job.workload];
    if (!policy) throw new Error('No model policy for this workload.');
    if (!job.promptVersion || !job.validationVersion || job.prefix.length > 32_000)
      throw new Error('Model jobs require bounded, versioned prompt and validation contracts.');
    const encoded = canonicalJson(job.input);
    // UTF-8 bytes plus protocol overhead is a conservative input-token allowance, not a tokenizer.
    const inputTokens = new TextEncoder().encode(encoded).length + 512;
    const prefixKey = await digest([
      this.config.scope,
      job.workload,
      job.audience,
      job.promptVersion,
      job.prefix,
    ]);
    const candidates = this.config.profiles.flatMap((profile) => {
      const health = this.health.get(profile.id);
      const latency = health?.latency ?? profile.expectedLatencyMs;
      const output = Math.min(policy.maxOutputTokens, profile.maxOutputTokens);
      if (
        !policy.models.includes(profile.id) ||
        (!profile.local && (job.privacy === 'local-only' || !this.config.allowRemote)) ||
        !capabilities[job.workload].every((capability) =>
          profile.capabilities.includes(capability),
        ) ||
        profile.quality < policy.minimumQuality ||
        inputTokens + output > profile.contextTokens ||
        latency > policy.maxLatencyMs ||
        (health?.until ?? 0) > this.now()
      )
        return [];
      return [{ profile, output, latency, cost: modelCost(profile, inputTokens, output) }];
    });
    candidates.sort((a, b) => {
      const primary =
        policy.strategy === 'quality'
          ? b.profile.quality - a.profile.quality
          : policy.strategy === 'latency'
            ? a.latency - b.latency
            : a.cost - b.cost;
      return (
        primary ||
        a.cost - b.cost ||
        policy.models.indexOf(a.profile.id) - policy.models.indexOf(b.profile.id)
      );
    });
    if (!candidates.length) throw new Error('No model meets this workload policy.');
    if (policy.strategy === 'economy') {
      const first = candidates[0];
      const warmIndex = candidates.findIndex(
        (candidate) =>
          candidate.cost <= first.cost * (1 + policy.affinityTolerancePercent / 100) &&
          (this.warm.get(`${candidate.profile.id}:${prefixKey}`) ?? 0) > this.now(),
      );
      if (warmIndex > 0) candidates.unshift(...candidates.splice(warmIndex, 1));
    }
    const reusable = !!job.cache && cacheable.has(job.workload);
    if (
      job.cache &&
      (!cacheable.has(job.workload) ||
        !job.cache.revision ||
        !Number.isFinite(job.cache.ttlMs) ||
        job.cache.ttlMs <= 0)
    )
      throw new Error('Output caching requires a pure, versioned workload with a positive TTL.');
    // Model, endpoint, rates, policy, scope, all input and both contract versions invalidate reuse.
    const key = reusable
      ? await digest([
          this.config.scope,
          job,
          policy,
          candidates.map((candidate) => candidate.profile),
        ])
      : undefined;
    if (key) {
      let stored: { value: unknown; profileId: string } | undefined;
      try {
        stored = (await this.cache.get(key)) as typeof stored;
      } catch {
        /* Advisory cache outage: perform a fresh bounded request. */
      }
      if (
        stored &&
        typeof stored === 'object' &&
        candidates.some((candidate) => candidate.profile.id === stored!.profileId)
      ) {
        try {
          const value = validate(stored.value);
          this.counters.resultCacheHits++;
          return { value, profileId: stored.profileId, cacheHit: true };
        } catch {
          try {
            await this.cache.delete(key);
          } catch {
            /* Validation still gates every hit. */
          }
        }
      }
      const running = this.pending.get(key);
      if (running) {
        this.counters.coalesced++;
        const result = await running;
        return { ...result, value: validate(structuredClone(result.value)) };
      }
    }
    const dispatch = async (): Promise<ModelResult<T>> => {
      let maximumSpent = 0;
      let attempts = 0;
      const deadline = this.now() + policy.maxLatencyMs;
      for (const candidate of candidates) {
        if (attempts >= policy.maxAttempts) break;
        const remaining = deadline - this.now();
        if (remaining <= 0) break;
        if (maximumSpent + candidate.cost > policy.maxRequestMicroUsd) continue;
        const id = await this.budget.reserve({
          profileId: candidate.profile.id,
          workload: job.workload,
          maximumMicroUsd: candidate.cost,
        });
        if (!id) continue;
        attempts++;
        maximumSpent += candidate.cost;
        this.counters.attempts++;
        const started = this.now();
        const executionRemaining = deadline - started;
        if (executionRemaining <= 0) {
          await this.budget.settle(
            id,
            { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
            true,
          );
          break;
        }
        let usage: ModelUsage | undefined;
        let value: T;
        const signal = AbortSignal.timeout(Math.max(1, Math.floor(executionRemaining)));
        try {
          const result = await execute({
            input: job.input,
            profile: candidate.profile,
            maxOutputTokens: candidate.output,
            signal,
            promptCacheKey: candidate.profile.promptCache === 'key' ? `ew-${prefixKey}` : undefined,
            sessionAffinity:
              candidate.profile.promptCache === 'cloudflare' ? `ew-${prefixKey}` : undefined,
          });
          usage = result.usage;
          signal.throwIfAborted();
          if (this.now() > deadline) throw new ModelExecutionError(usage);
          value = validate(result.value);
        } catch (error) {
          if (error instanceof ModelExecutionError) usage = error.usage;
          // A failed durable settlement halts the call; never hide storage failure behind failover.
          await this.budget.settle(id, validUsage(usage) ? usage : undefined, true);
          const health = this.health.get(candidate.profile.id);
          const failures = (health?.failures ?? 0) + 1;
          this.health.set(candidate.profile.id, {
            failures,
            until: failures >= 2 ? this.now() + 30_000 : 0,
          });
          this.counters.failures++;
          continue;
        }
        await this.budget.settle(id, validUsage(usage) ? usage : undefined, false);
        const latency = Math.max(1, this.now() - started);
        const prior = this.health.get(candidate.profile.id)?.latency;
        this.health.set(candidate.profile.id, {
          failures: 0,
          until: 0,
          latency: prior ? prior * 0.75 + latency * 0.25 : latency,
        });
        if (candidate.profile.promptCache !== 'none') {
          for (const [id, until] of this.warm) if (until <= this.now()) this.warm.delete(id);
          if (this.warm.size >= 128) this.warm.delete(this.warm.keys().next().value!);
          this.warm.set(`${candidate.profile.id}:${prefixKey}`, this.now() + 300_000);
        }
        const result = { value, profileId: candidate.profile.id, cacheHit: false };
        if (key) {
          try {
            await this.cache.set(key, { value, profileId: candidate.profile.id }, job.cache!.ttlMs);
          } catch {
            /* A cache write cannot replay or invalidate an already completed model call. */
          }
        }
        return result;
      }
      throw new Error('Model route unavailable or allowance exhausted.');
    };
    if (this.active >= 16) throw new Error('Model dispatcher is at capacity.');
    this.active++;
    const promise = dispatch();
    if (key) this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.active--;
      if (key) this.pending.delete(key);
    }
  }
}
