import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { modelJob, modelPolicy, modelProfile, routingConfig } from '../../../tests/model-fixtures';
import { reserveRoutingBudget, settleRoutingBudget, type RoutingLedger } from './budget';
import {
  ModelExecutionError,
  type ModelBudgetPort,
  type ModelExecution,
  type ModelJob,
  type RoutingConfig,
} from './contracts';
import { WorkloadRouter } from './router';
import { ExactModelCache } from './cache';

function harness(config = routingConfig()) {
  let now = Date.UTC(2026, 10, 8);
  let ledger: RoutingLedger | undefined;
  let sequence = 0;
  const events: string[] = [];
  const budget: ModelBudgetPort = {
    reserve: vi.fn(async (estimate) => {
      const id = `attempt-${++sequence}`;
      const next = reserveRoutingBudget(ledger, estimate, config.dailyMicroUsd, now, id);
      if (!next) return null;
      ledger = next;
      events.push(`reserved:${estimate.profileId}`);
      return id;
    }),
    settle: vi.fn(async (id, usage, failed) => {
      const receipt = ledger!.receipts.find((item) => item.id === id)!;
      ledger = settleRoutingBudget(
        ledger!,
        id,
        config.profiles.find((item) => item.id === receipt.profileId)!,
        usage,
        failed,
      );
      events.push(`settled:${receipt.profileId}`);
    }),
  };
  const router = new WorkloadRouter(config, budget, () => now);
  return {
    router,
    budget,
    events,
    ledger: () => structuredClone(ledger),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const parseText = (value: unknown) => z.string().parse(value);
const succeed = vi.fn(async (_execution: ModelExecution) => ({
  value: 'ok',
  usage: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 10 },
}));

describe('workload selection and bounded dispatch', () => {
  it('does not accept a late action or spend another attempt after the whole job deadline', async () => {
    const config = routingConfig({
      profiles: [modelProfile(), modelProfile('backup')],
      policies: { decision: modelPolicy({ models: ['cf-routine', 'backup'], maxAttempts: 2 }) },
    });
    const h = harness(config);
    const execute = vi.fn(async () => {
      h.advance(20_001);
      return { value: 'late', usage: { inputTokens: 20, outputTokens: 1, cachedInputTokens: 0 } };
    });
    await expect(h.router.run(modelJob(), execute, parseText)).rejects.toThrow();
    expect(execute).toHaveBeenCalledOnce();
    expect(h.ledger()!.receipts[0]).toMatchObject({ status: 'failed', charged: 22 });
  });
  it('provides scoped Cloudflare session affinity without sending unsupported OpenAI cache fields', async () => {
    const h = harness(
      routingConfig({ profiles: [modelProfile('cf-routine', { promptCache: 'cloudflare' })] }),
    );
    const hints: string[] = [];
    await h.router.run(
      modelJob(),
      async (execution) => {
        expect(execution.promptCacheKey).toBeUndefined();
        hints.push(execution.sessionAffinity!);
        return { value: 'ok' };
      },
      parseText,
    );
    await h.router.run(
      modelJob({ input: { changed: 'new observation' } }),
      async (execution) => {
        hints.push(execution.sessionAffinity!);
        return { value: 'ok' };
      },
      parseText,
    );
    expect(hints[0]).toMatch(/^ew-[0-9a-f]{64}$/);
    expect(hints[0]).toBe(hints[1]);
  });
  it('uses an economical model for decisions and a capable high-quality model for code', async () => {
    const config = routingConfig({
      profiles: [
        modelProfile(),
        modelProfile('deep', {
          quality: 5,
          capabilities: ['text', 'json', 'code'],
          rates: { inputUsdPerMillion: 4, outputUsdPerMillion: 8, cachedInputUsdPerMillion: 1 },
        }),
      ],
      policies: {
        decision: modelPolicy({ models: ['deep', 'cf-routine'] }),
        code: modelPolicy({
          models: ['cf-routine', 'deep'],
          strategy: 'quality',
          minimumQuality: 4,
        }),
      },
    });
    const { router } = harness(config);
    expect((await router.run(modelJob(), succeed, parseText)).profileId).toBe('cf-routine');
    expect((await router.run(modelJob({ workload: 'code' }), succeed, parseText)).profileId).toBe(
      'deep',
    );
  });
  it('does not route local-only jobs to remote models or invent missing capabilities', async () => {
    const { router, budget } = harness();
    const execute = vi.fn();
    await expect(
      router.run(modelJob({ privacy: 'local-only' }), execute, parseText),
    ).rejects.toThrow('No model');
    const embedding = harness(routingConfig({ policies: { embedding: modelPolicy() } }));
    await expect(
      embedding.router.run(modelJob({ workload: 'embedding' }), execute, parseText),
    ).rejects.toThrow('No model');
    expect(execute).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it('rejects unknown job fields, privacy values and oversized context before reservation', async () => {
    const { router, budget } = harness();
    await expect(
      router.run(modelJob({ privacy: 'anything' as never }), succeed, parseText),
    ).rejects.toThrow('contract');
    await expect(
      router.run(modelJob({ input: 'x'.repeat(128_001) }), succeed, parseText),
    ).rejects.toThrow('allowance');
    const small = harness(
      routingConfig({ profiles: [modelProfile('cf-routine', { contextTokens: 1024 })] }),
    );
    await expect(
      small.router.run(modelJob({ input: 'x'.repeat(1000) }), succeed, parseText),
    ).rejects.toThrow('No model');
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it('reserves every failover attempt and enforces a combined request allowance', async () => {
    const config = routingConfig({
      profiles: [modelProfile(), modelProfile('backup')],
      policies: { decision: modelPolicy({ models: ['cf-routine', 'backup'], maxAttempts: 2 }) },
    });
    const h = harness(config);
    const execute = vi.fn(async ({ profile }: ModelExecution) => {
      h.events.push(`executed:${profile.id}`);
      if (profile.id === 'cf-routine')
        throw new ModelExecutionError({ inputTokens: 20, outputTokens: 1, cachedInputTokens: 0 });
      return { value: 'ok' };
    });
    expect((await h.router.run(modelJob(), execute, parseText)).profileId).toBe('backup');
    expect(h.events).toEqual([
      'reserved:cf-routine',
      'executed:cf-routine',
      'settled:cf-routine',
      'reserved:backup',
      'executed:backup',
      'settled:backup',
    ]);
    expect(h.ledger()!.receipts.map((item) => item.status)).toEqual(['failed', 'complete']);
    const firstBound = h.ledger()!.receipts[0].reserved;
    const tight = harness({
      ...config,
      policies: {
        decision: modelPolicy({
          models: ['cf-routine', 'backup'],
          maxAttempts: 2,
          maxRequestMicroUsd: firstBound,
        }),
      },
    });
    const fail = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(tight.router.run(modelJob(), fail, parseText)).rejects.toThrow('allowance');
    expect(fail).toHaveBeenCalledOnce();
  });
  it('does no I/O after a failed reservation and no failover after failed durable settlement', async () => {
    const config = routingConfig({
      profiles: [modelProfile(), modelProfile('backup')],
      policies: { decision: modelPolicy({ models: ['cf-routine', 'backup'], maxAttempts: 2 }) },
    });
    const blocked = harness({ ...config, dailyMicroUsd: 0 });
    const execute = vi.fn(async () => ({ value: 'ok' }));
    await expect(blocked.router.run(modelJob(), execute, parseText)).rejects.toThrow('allowance');
    expect(execute).not.toHaveBeenCalled();
    const h = harness(config);
    vi.mocked(h.budget.settle).mockRejectedValue(new Error('storage lost'));
    await expect(h.router.run(modelJob(), execute, parseText)).rejects.toThrow('storage lost');
    expect(execute).toHaveBeenCalledOnce();
  });
  it('opens a temporary circuit after repeated failures without endless retries', async () => {
    const h = harness();
    const fail = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(h.router.run(modelJob(), fail, parseText)).rejects.toThrow();
    await expect(h.router.run(modelJob(), fail, parseText)).rejects.toThrow();
    await expect(h.router.run(modelJob(), fail, parseText)).rejects.toThrow('No model');
    expect(fail).toHaveBeenCalledTimes(2);
    h.advance(30_001);
    expect((await h.router.run(modelJob(), succeed, parseText)).value).toBe('ok');
  });
  it('uses a warm prefix within the configured price tolerance and keeps keys opaque', async () => {
    const config = routingConfig({
      profiles: [
        modelProfile(),
        modelProfile('backup', {
          rates: {
            inputUsdPerMillion: 1.05,
            outputUsdPerMillion: 2.1,
            cachedInputUsdPerMillion: 0.1,
          },
        }),
      ],
      policies: { decision: modelPolicy({ models: ['cf-routine', 'backup'], maxAttempts: 2 }) },
    });
    const h = harness(config);
    const keys: string[] = [];
    let first = true;
    const execute = async (execution: ModelExecution) => {
      keys.push(execution.promptCacheKey!);
      if (first) {
        first = false;
        throw new Error('temporary failure');
      }
      return { value: 'ok' };
    };
    expect(
      (await h.router.run(modelJob({ input: { private: 'VISITOR-CANARY' } }), execute, parseText))
        .profileId,
    ).toBe('backup');
    expect(
      (await h.router.run(modelJob({ input: { private: 'DIFFERENT-CANARY' } }), execute, parseText))
        .profileId,
    ).toBe('backup');
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^ew-[0-9a-f]{64}$/);
    expect(JSON.stringify(h.router.stats())).not.toContain('CANARY');
    const other = harness({ ...config, scope: { ...config.scope, characterId: 'another' } });
    let otherKey: string | undefined;
    await other.router.run(
      modelJob(),
      async (request) => {
        otherKey = request.promptCacheKey;
        return { value: 'ok' };
      },
      parseText,
    );
    expect(otherKey).not.toBe(keys[0]);
  });
});

describe('exact caching without stale agent actions', () => {
  const summary = () =>
    modelJob({ workload: 'summary', cache: { revision: 'source-1', ttlMs: 5000 } });
  it('caches only a validated pure output, with canonical input and isolated returned values', async () => {
    const h = harness();
    const execute = vi.fn(async () => ({ value: { text: 'safe' } }));
    const validate = (value: unknown) => z.object({ text: z.string() }).parse(value);
    const first = await h.router.run({ ...summary(), input: { b: 2, a: 1 } }, execute, validate);
    first.value.text = 'mutated';
    const second = await h.router.run({ ...summary(), input: { a: 1, b: 2 } }, execute, validate);
    expect(second).toMatchObject({ value: { text: 'safe' }, cacheHit: true });
    second.value.text = 'mutated again';
    expect(
      (await h.router.run({ ...summary(), input: { a: 1, b: 2 } }, execute, validate)).value.text,
    ).toBe('safe');
    expect(execute).toHaveBeenCalledOnce();
    expect(h.budget.reserve).toHaveBeenCalledOnce();
  });
  it.each([
    { input: { observation: 'different bird' } },
    { promptVersion: 'v2' },
    { validationVersion: 'v2' },
    { prefix: 'Different policy.' },
    { cache: { revision: 'source-2', ttlMs: 5000 } },
  ] satisfies Array<Partial<ModelJob>>)(
    'invalidates exact reuse when the contract or source changes: %j',
    async (change) => {
      const h = harness();
      const execute = vi.fn(async () => ({ value: 'ok' }));
      await h.router.run(summary(), execute, parseText);
      expect((await h.router.run({ ...summary(), ...change }, execute, parseText)).cacheHit).toBe(
        false,
      );
      expect(execute).toHaveBeenCalledTimes(2);
    },
  );
  it('partitions a shared cache by owner, world, character and recipient', async () => {
    const cache = new ExactModelCache();
    const execute = vi.fn(async () => ({ value: 'private summary' }));
    const initial = routingConfig();
    const cases: RoutingConfig[] = [
      initial,
      ...(['ownerId', 'worldId', 'characterId'] as const).map((key) => ({
        ...initial,
        scope: { ...initial.scope, [key]: 'different' },
      })),
    ];
    for (const config of cases) {
      const h = harness(config);
      const router = new WorkloadRouter(config, h.budget, Date.now, cache);
      expect((await router.run(summary(), execute, parseText)).cacheHit).toBe(false);
      expect((await router.run(summary(), execute, parseText)).cacheHit).toBe(true);
    }
    const h = harness(initial);
    const router = new WorkloadRouter(initial, h.budget, Date.now, cache);
    expect(
      (await router.run({ ...summary(), audience: 'visitor-123' }, execute, parseText)).cacheHit,
    ).toBe(false);
    expect(execute).toHaveBeenCalledTimes(5);
  });
  it('expires outputs and coalesces only identical pure jobs', async () => {
    const h = harness();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => {
      await wait;
      return { value: 'ok' };
    });
    const first = h.router.run(summary(), execute, parseText);
    const second = h.router.run(summary(), execute, parseText);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    release();
    await Promise.all([first, second]);
    expect(h.router.stats().coalesced).toBe(1);
    h.advance(5001);
    expect((await h.router.run(summary(), execute, parseText)).cacheHit).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('never replays decisions or enables action caching by caller request', async () => {
    const h = harness();
    const execute = vi.fn(async () => ({ value: 'ok' }));
    await h.router.run(modelJob(), execute, parseText);
    await h.router.run(modelJob(), execute, parseText);
    expect(execute).toHaveBeenCalledTimes(2);
    await expect(
      h.router.run(modelJob({ cache: { revision: 'same', ttlMs: 1000 } }), execute, parseText),
    ).rejects.toThrow('pure');
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('does not cache failed or invalid results', async () => {
    const h = harness();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ value: 123 })
      .mockResolvedValue({ value: 'ok' });
    await expect(h.router.run(summary(), execute, parseText)).rejects.toThrow();
    expect((await h.router.run(summary(), execute, parseText)).cacheHit).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
