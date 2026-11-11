import { z } from 'zod';
import {
  ModelExecutionError,
  type ModelBudgetPort,
  type ModelUsage,
  type RoutingConfig,
} from '../../../models/src/contracts';
import { parseRoutingConfig } from '../../../models/src/config';
import { canonicalJson } from '../../../models/src/data';
import { WorkloadRouter } from '../../../models/src/router';
import type { CompatibleModelOptions } from './compatible';
import type { OllamaOptions } from './ollama';
import { readModelPayload, reportedUsage, usageCount } from './shared';

export const PORTRAIT_TEXT_LIMIT = 1200;
/**
 * Writing about oneself after a rest. Everything in it is the character's own record: its
 * pursuits, creations, previous portrait and readings, never outside messages or private mail.
 */
export const ReflectionInputSchema = z
  .object({
    form: z.literal('portrait'),
    identity: z.string().trim().min(1).max(4000),
    pursuits: z
      .array(
        z
          .object({
            question: z.string().max(240),
            why: z.string().max(240),
            status: z.enum(['active', 'open', 'set-aside']),
            setAsideReason: z.string().max(240).optional(),
            notes: z.array(z.string().max(600)).max(4),
          })
          .strict(),
      )
      .max(12),
    creations: z
      .array(z.object({ title: z.string().max(120), url: z.string().max(2048) }).strict())
      .max(32),
    previous: z.string().max(PORTRAIT_TEXT_LIMIT).optional(),
    readings: z.array(z.string().max(240)).max(12),
  })
  .strict();

export type ReflectionInput = z.infer<typeof ReflectionInputSchema>;
export interface ReflectionProvider {
  /** Refresh local connection state only; provider and host budgets remain authoritative. */
  resetAvailability?(): void;
  isAvailable?(): boolean;
  readonly id: string;
  readonly managesAllowance?: boolean;
  readonly localOnly?: boolean;
  /** The text of the portrait; empty when the model wrote nothing usable. */
  reflect(input: ReflectionInput): Promise<string>;
}
export type OllamaReflectionOptions = Omit<OllamaOptions, 'messages'>;
export type CompatibleReflectionOptions = Omit<CompatibleModelOptions, 'messages'>;

export const REFLECTION_PROMPT_VERSION = 'portrait-v1';
const validationVersion = 'portrait-text-v1';

function reflectionInput(input: ReflectionInput): ReflectionInput {
  return ReflectionInputSchema.parse(input);
}

export function reflectionMessages(input: ReflectionInput) {
  const { identity, form: _form, ...data } = reflectionInput(input);
  return [
    {
      role: 'system',
      content: `${identity}\nYou have just rested. Write a short portrait of yourself as you are now, in your own voice, for yourself and for visitors: what you have been following and what you found, what you keep coming back to, what you left unfinished and why, what you would like to do next. Only what the record shows; do not invent findings. At most ${PORTRAIT_TEXT_LIMIT} characters. Return only the text.`,
    },
    { role: 'user', content: canonicalJson(data) },
  ];
}

/** The portrait as plain text: no fence, no control characters, at most 1200 characters. */
export function validateReflectionProposal(value: unknown, _input?: ReflectionInput): string {
  const text = z
    .string()
    .max(PORTRAIT_TEXT_LIMIT * 8)
    .parse(value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim()
    .replace(/^```[\w+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/, '$1')
    .trim();
  return text.slice(0, PORTRAIT_TEXT_LIMIT).trim();
}

function parseProposal(content: unknown, input: ReflectionInput): string {
  if (typeof content !== 'string') throw new Error('Model did not return text.');
  return validateReflectionProposal(content, input);
}

function ollamaBase(options: OllamaReflectionOptions): URL {
  const base = new URL(options.baseUrl ?? 'http://127.0.0.1:11434');
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Local reflection requires a loopback URL without embedded credentials.');
  return base;
}

function compatibleEndpoint(options: CompatibleReflectionOptions): URL {
  const base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))
  )
    throw new Error('Reflection endpoints require HTTPS without embedded credentials.');
  if (!options.model || !options.apiKey)
    throw new Error('Compatible reflection requires a model name and credential.');
  return new URL('chat/completions', base);
}

type ReflectionMessages = ReturnType<typeof reflectionMessages>;
async function ollamaText(options: OllamaReflectionOptions, messages: ReflectionMessages) {
  const response = await (options.fetcher ?? fetch)(new URL('/api/chat', ollamaBase(options)), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 30_000),
      ...(options.signal ? [options.signal] : []),
    ]),
    body: JSON.stringify({
      model: options.model ?? 'qwen3:4b',
      stream: false,
      think: false,
      keep_alive: '5m',
      options: {
        temperature: 0.6,
        num_ctx: options.contextTokens ?? 8192,
        num_predict: options.maxOutputTokens ?? 500,
      },
      messages,
    }),
  });
  const payload = (await readModelPayload(response)) as {
    message?: { content?: unknown };
    prompt_eval_count?: unknown;
    eval_count?: unknown;
  };
  options.onUsage?.(usageCount(payload.prompt_eval_count), usageCount(payload.eval_count));
  options.onUsageDetails?.(reportedUsage(payload.prompt_eval_count, payload.eval_count));
  return payload.message?.content;
}

async function compatibleText(options: CompatibleReflectionOptions, messages: ReflectionMessages) {
  const endpoint = compatibleEndpoint(options);
  const response = await (options.fetcher ?? fetch)(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
      ...(options.sessionAffinity ? { 'x-session-affinity': options.sessionAffinity } : {}),
      ...(options.cloudflareGateway || endpoint.hostname === 'gateway.ai.cloudflare.com'
        ? {
            'cf-aig-skip-cache': 'true',
            'cf-aig-max-attempts': '1',
            'cf-aig-collect-log': 'false',
          }
        : {}),
    },
    redirect: 'error',
    signal: AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 15_000),
      ...(options.signal ? [options.signal] : []),
    ]),
    body: JSON.stringify({
      model: options.model,
      temperature: 0.6,
      max_tokens: options.maxOutputTokens ?? 500,
      ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
      messages,
    }),
  });
  const payload = (await readModelPayload(response)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      prompt_tokens_details?: { cached_tokens?: unknown };
    };
  };
  options.onUsage?.(
    usageCount(payload.usage?.prompt_tokens),
    usageCount(payload.usage?.completion_tokens),
  );
  options.onUsageDetails?.(
    reportedUsage(
      payload.usage?.prompt_tokens,
      payload.usage?.completion_tokens,
      payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    ),
  );
  return payload.choices?.[0]?.message?.content;
}

/** Legacy transports leave call reservation to the host, like their waking counterparts. */
export class OllamaReflectionProvider implements ReflectionProvider {
  readonly id = 'ollama';
  readonly localOnly = true;
  constructor(private readonly options: OllamaReflectionOptions = {}) {
    ollamaBase(options);
  }
  async reflect(input: ReflectionInput): Promise<string> {
    const bounded = reflectionInput(input);
    return parseProposal(await ollamaText(this.options, reflectionMessages(bounded)), bounded);
  }
}

export class CompatibleReflectionProvider implements ReflectionProvider {
  readonly id = 'compatible';
  readonly localOnly: boolean;
  constructor(private readonly options: CompatibleReflectionOptions) {
    this.localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(
      compatibleEndpoint(options).hostname,
    );
  }
  async reflect(input: ReflectionInput): Promise<string> {
    const bounded = reflectionInput(input);
    return parseProposal(await compatibleText(this.options, reflectionMessages(bounded)), bounded);
  }
}

/** Shares the durable waking allowance port; no exact output caching or implicit escalation. */
export class RoutedReflectionProvider implements ReflectionProvider {
  readonly id = 'routed';
  readonly managesAllowance = true;
  readonly localOnly: boolean;
  readonly router: WorkloadRouter;
  readonly config: RoutingConfig;
  private readonly keys = new Map<string, string>();
  constructor(
    input: RoutingConfig,
    budget: ModelBudgetPort,
    environment: NodeJS.ProcessEnv,
    private readonly options: {
      production?: boolean;
      fetcher?: typeof fetch;
      now?: () => number;
    } = {},
  ) {
    this.config = parseRoutingConfig(input, options.production);
    const policy = this.config.policies.reflection;
    if (!policy) throw new Error('Routed reflection requires a reflection workload policy.');
    this.localOnly = policy.models.every(
      (id) => this.config.profiles.find((profile) => profile.id === id)!.local,
    );
    for (const profile of this.config.profiles) {
      if (!policy.models.includes(profile.id)) continue;
      if (profile.transport === 'compatible' && profile.apiKeyEnv) {
        const key = environment[profile.apiKeyEnv];
        if (!key) throw new Error('A configured model credential is missing.');
        this.keys.set(profile.id, key);
      }
    }
    this.router = new WorkloadRouter(this.config, budget, options.now);
  }
  async reflect(input: ReflectionInput): Promise<string> {
    const bounded = reflectionInput(input);
    const messages = reflectionMessages(bounded);
    const result = await this.router.run(
      {
        workload: 'reflection',
        input: { messages },
        prefix: messages[0].content,
        promptVersion: REFLECTION_PROMPT_VERSION,
        validationVersion,
        privacy: this.config.allowRemote ? 'remote-allowed' : 'local-only',
        audience: 'character-private',
      },
      async (execution) => {
        let usage: ModelUsage | undefined;
        const common = {
          baseUrl: execution.profile.baseUrl,
          model: execution.profile.model,
          signal: execution.signal,
          timeoutMs: this.config.policies.reflection!.maxLatencyMs,
          maxOutputTokens: execution.maxOutputTokens,
          onUsageDetails: (reported: ModelUsage | undefined) => {
            usage = reported;
          },
          fetcher: this.options.fetcher,
        };
        const snapshot = (execution.input as { messages: ReflectionMessages }).messages;
        try {
          const content =
            execution.profile.transport === 'ollama'
              ? await ollamaText(
                  { ...common, contextTokens: execution.profile.contextTokens },
                  snapshot,
                )
              : await compatibleText(
                  {
                    ...common,
                    apiKey: this.keys.get(execution.profile.id)!,
                    promptCacheKey: execution.promptCacheKey,
                    sessionAffinity: execution.sessionAffinity,
                    cloudflareGateway: execution.profile.gateway === 'cloudflare',
                  },
                  snapshot,
                );
          return { value: parseProposal(content, bounded), usage };
        } catch {
          throw new ModelExecutionError(usage);
        }
      },
      (value) => validateReflectionProposal(value, bounded),
    );
    return result.value;
  }
}
