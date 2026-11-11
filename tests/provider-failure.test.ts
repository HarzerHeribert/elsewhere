import { describe, expect, it, vi } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';

import { BrokerDecisionProvider, BrokerModelClient } from '../packages/adapters/src/models/broker';

const epoch = Date.UTC(2026, 10, 9, 12);
class MemoryStore implements SnapshotStore<ControllerState> {
  saved: StoredSnapshot<ControllerState> | null = null;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: ControllerState, expected: number) {
    expect(expected).toBe(this.saved?.version ?? 0);
    this.saved = { value: structuredClone(value), version: expected + 1 };
    return expected + 1;
  }
  async close() {}
}

describe('model-driven life without a local substitute', () => {
  it('keeps the world ticking but chooses no activity when no provider is configured', async () => {
    const store = new MemoryStore();
    const controller = await new ElsewhereController(store, { now: () => epoch }).init();
    try {
      const before = controller.getSnapshot();
      for (let i = 0; i < 30; i++) await controller.step();
      const after = controller.getSnapshot();
      expect(after.runtime.tick).toBe(30);
      expect(after.world.events).toEqual(before.world.events);
      expect(after.memories).toEqual(before.memories);
      expect(store.saved!.value.hubert.turn).toBe(0);
      expect(after.character.activity).toBe('Currently unavailable');
      expect(controller.getCharacterIssues()).toEqual([
        expect.objectContaining({
          characterId: 'hubert',
          workload: 'decision',
          kind: 'unconfigured',
        }),
      ]);
    } finally {
      await controller.close();
    }
  });

  it('retains one private failure through restart, waits, then recovers without the owner', async () => {
    const store = new MemoryStore();
    let now = epoch;
    const propose = vi
      .fn()
      .mockRejectedValueOnce(new Error('PRIVATE-PROVIDER-SECRET-CANARY'))
      .mockResolvedValue({ action: { type: 'reflect' }, why: '' });
    const options = { now: () => now, modelProvider: { id: 'fixture', propose } };
    const first = await new ElsewhereController(store, options).init();
    await first.step();
    const issues = first.getCharacterIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'failed', retrying: true, since: epoch });
    expect(issues[0].message).toContain('Hubert will try again automatically');
    expect(JSON.stringify(first.getSnapshot())).not.toContain('PRIVATE-');
    expect(JSON.stringify(issues)).not.toContain('PRIVATE-');
    await first.close();
    const restarted = await new ElsewhereController(store, options).init();
    try {
      // The wait survives the restart: nothing is sent before one decision interval has passed.
      now += 89_000;
      for (let i = 0; i < 20; i++) await restarted.step();
      expect(propose).toHaveBeenCalledTimes(1);
      expect(restarted.getCharacterIssues()).toEqual(issues);
      now += 1_000;
      await restarted.step();
      expect(propose).toHaveBeenCalledTimes(2);
      expect(restarted.getCharacterIssues()[0]).toMatchObject({
        id: issues[0].id,
        resolvedAt: now,
      });
      expect(restarted.getSnapshot().character.activity).toBe('Putting things together');
      const copy = restarted.getCharacterIssues();
      copy[0].message = 'mutated';
      expect(restarted.getCharacterIssues()[0].message).not.toBe('mutated');
    } finally {
      await restarted.close();
    }
  });

  it('does not let retries bypass the durable daily model allowance', async () => {
    const store = new MemoryStore();
    const propose = vi.fn(async () => {
      throw new Error('upstream failed');
    });
    const controller = await new ElsewhereController(store, {
      now: () => epoch,
      modelMaximum: 1,
      modelProvider: { id: 'fixture', propose },
    }).init();
    try {
      await controller.step();
      await controller.retryCharacterProvider();
      await controller.step();
      expect(propose).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().runtime.modelCalls).toBe(1);
      expect(controller.getCharacterIssues()).toEqual([
        expect.objectContaining({ kind: 'allowance' }),
      ]);
      expect(controller.getCharacterIssues()[0].resolvedAt).toBeUndefined();
      expect(store.saved!.value.hubert.turn).toBe(0);
    } finally {
      await controller.close();
    }
  });
});

it('owner retry rechecks broker authorization after repair while retaining charged attempts', async () => {
  const store = new MemoryStore();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'not_authorized' }, { status: 403 }))
    .mockImplementation(async () =>
      Response.json({ value: { action: { type: 'reflect' }, why: '' } }),
    );
  const provider = new BrokerDecisionProvider(
    new BrokerModelClient({
      baseUrl: 'https://inference.example',
      token: 'fixture-service-credential-'.repeat(2),
      expectedBinding: {
        worldId: 'elsewhere',
        ownerUserId: 'fixture-owner',
        characterId: 'hubert',
        connectionId: 'fixture-plan',
      },
      fetcher,
    }),
  );
  const controller = await new ElsewhereController(store, {
    now: () => epoch,
    modelMaximum: 2,
    modelProvider: provider,
  }).init();
  try {
    await controller.step();
    expect(provider.isAvailable()).toBe(false);
    await controller.step();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await controller.retryCharacterProvider();
    await controller.step();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(epoch);
    expect(controller.getSnapshot().runtime.modelCalls).toBe(2);
    // A successful reconnect grants no extra host allowance.
    await controller.step();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controller.getCharacterIssues()).toContainEqual(
      expect.objectContaining({ kind: 'allowance' }),
    );
  } finally {
    await controller.close();
  }
});

it('waits for a normal turn after an unusable reply and lets the model correct it without a substitute', async () => {
  const store = new MemoryStore();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: 'invalid_action',
          diagnostic: { code: 'invalid_action', fields: ['durationMs'] },
          usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 0 },
        },
        { status: 400 },
      ),
    )
    .mockResolvedValue(Response.json({ value: { action: { type: 'reflect' }, why: '' } }));
  const provider = new BrokerDecisionProvider(
    new BrokerModelClient({
      baseUrl: 'https://inference.example',
      token: 'fixture-credential-'.repeat(3),
      expectedBinding: {
        worldId: 'elsewhere',
        ownerUserId: 'fixture-owner',
        characterId: 'hubert',
        connectionId: 'fixture-plan',
      },
      fetcher,
    }),
  );
  const controller = await new ElsewhereController(store, {
    now: () => epoch,
    simulationStepMs: 30_000,
    decisionIntervalMs: 90_000,
    modelProvider: provider,
  }).init();
  try {
    const before = controller.getSnapshot();
    await controller.step();
    expect(provider.isAvailable()).toBe(true);
    expect(controller.getCharacterIssues()).toMatchObject([
      { kind: 'invalid', code: 'invalid_action', fields: ['durationMs'], retrying: true },
    ]);
    expect(controller.getSnapshot().world.events).toEqual(before.world.events);
    expect(controller.getSnapshot().memories).toEqual(before.memories);
    expect(store.saved!.value.hubert.turn).toBe(0);
    await controller.tick();
    await controller.tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await controller.tick();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
    expect(body.context.state.lastDecisionProblem).toMatchObject({
      code: 'invalid_action',
      fields: ['durationMs'],
    });
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(epoch);
    expect(controller.getSnapshot().character.activity).toBe('Putting things together');
    expect(store.saved!.value.hubert.lastDecisionProblem).toBeUndefined();
    expect(controller.getSnapshot().runtime.modelCalls).toBe(2);
  } finally {
    await controller.close();
  }
});

it('paces declined world proposals across restart instead of stopping the character, and never executes them', async () => {
  const store = new MemoryStore();
  const propose = vi.fn(
    async (): Promise<unknown> => ({
      action: { type: 'inspect', targetId: 'unknown-fixture-target' },
      why: '',
    }),
  );
  const options = {
    now: () => epoch,
    simulationStepMs: 30_000,
    decisionIntervalMs: 90_000,
    modelProvider: { id: 'fixture', propose },
  };
  const ticksUntilNextCall = async (controller: ElsewhereController) => {
    const calls = propose.mock.calls.length;
    for (let ticks = 1; ticks <= 40; ticks++) {
      await controller.tick();
      if (propose.mock.calls.length > calls) return ticks;
    }
    return Infinity;
  };
  const first = await new ElsewhereController(store, options).init();
  const before = first.getSnapshot();
  await first.step();
  // Each further decline doubles the wait: one interval, then two, then four.
  expect(await ticksUntilNextCall(first)).toBe(3);
  expect(await ticksUntilNextCall(first)).toBe(6);
  expect(propose).toHaveBeenCalledTimes(3);
  expect(first.getSnapshot().memories).toEqual(before.memories);
  expect(first.getSnapshot().world.events).toEqual(before.world.events);
  expect(store.saved!.value.hubert.turn).toBe(0);
  expect(store.saved!.value.hubert.lastOutcome).toMatchObject({
    action: 'inspect',
    status: 'rejected',
    targetId: 'unknown-fixture-target',
  });
  // A working model choosing poorly is feedback for its next turn, never an outage.
  expect(first.getCharacterIssues()).toMatchObject([
    { kind: 'invalid', code: 'unavailable_action', retrying: true },
  ]);
  expect(first.getCharacterIssues()[0].message).toContain('Hubert will reconsider');
  expect(first.getSnapshot().character.activity).toBe('Considering another approach');
  expect(store.saved!.value.runtime).toMatchObject({
    declinedDecisionCount: 3,
    invalidDecisionCount: 0,
  });
  await first.close();
  const next = await new ElsewhereController(store, options).init();
  try {
    expect(await ticksUntilNextCall(next)).toBe(12);
    // The wait is capped at eight intervals, so the character keeps trying unattended.
    expect(await ticksUntilNextCall(next)).toBe(24);
    expect(await ticksUntilNextCall(next)).toBe(24);
    expect(propose).toHaveBeenCalledTimes(6);
    expect(next.getCharacterIssues()).toMatchObject([{ retrying: true }]);
    propose.mockResolvedValue({ action: { type: 'reflect' }, why: '' });
    expect(await ticksUntilNextCall(next)).toBe(24);
    expect(next.getCharacterIssues()[0].resolvedAt).toBe(epoch);
    expect(store.saved!.value.runtime.declinedDecisionCount).toBe(0);
    expect(store.saved!.value.hubert.lastDecisionProblem).toBeUndefined();
    expect(next.getSnapshot().runtime.modelCalls).toBe(7);
  } finally {
    await next.close();
  }
});

it('still stops after three unreadable replies, and a declined proposal does not count towards that', async () => {
  const store = new MemoryStore();
  const propose = vi
    .fn(async (): Promise<unknown> => ({ type: 'teleport' }))
    .mockResolvedValueOnce({ type: 'teleport' })
    .mockResolvedValueOnce({ type: 'teleport' })
    .mockResolvedValueOnce({
      action: { type: 'inspect', targetId: 'unknown-fixture-target' },
      why: '',
    });
  const options = { now: () => epoch, modelProvider: { id: 'fixture', propose } };
  const controller = await new ElsewhereController(store, options).init();
  try {
    await controller.step();
    await controller.step();
    expect(store.saved!.value.runtime.invalidDecisionCount).toBe(2);
    await controller.step();
    // The readable but declined reply restarts the count of unreadable ones.
    expect(store.saved!.value.runtime).toMatchObject({
      invalidDecisionCount: 0,
      declinedDecisionCount: 1,
    });
    await controller.step();
    await controller.step();
    expect(controller.getCharacterIssues()).toMatchObject([
      { kind: 'invalid', code: 'invalid_action', retrying: true },
    ]);
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(6);
    expect(controller.getCharacterIssues()).toMatchObject([
      { kind: 'invalid', code: 'invalid_action', retrying: false },
    ]);
    expect(controller.getSnapshot().runtime.modelStatus).toBe('Hubert is currently unavailable');
    for (let i = 0; i < 10; i++) await controller.step();
    await controller.reset();
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(6);
    expect(store.saved!.value.runtime.invalidDecisionCount).toBe(3);
    await controller.retryCharacterProvider();
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(7);
    expect(controller.getSnapshot().runtime.modelCalls).toBe(7);
  } finally {
    await controller.close();
  }
});

it('a real request failure after an unusable reply waits for the provider, is not counted as unusable, and keeps errors private', async () => {
  const { InvalidDecisionError } = await import('../characters/runtime/src/index');
  const store = new MemoryStore();
  const propose = vi
    .fn()
    .mockRejectedValueOnce(new InvalidDecisionError('invalid_json'))
    .mockRejectedValue(new Error('PRIVATE-PROVIDER-CANARY'));
  const controller = await new ElsewhereController(store, {
    now: () => epoch,
    modelProvider: { id: 'fixture', propose },
  }).init();
  try {
    await controller.step();
    await controller.step();
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(2);
    const issue = controller.getCharacterIssues()[0];
    expect(issue.kind).toBe('failed');
    expect(issue.retrying).toBe(true);
    expect(issue.code).toBe('decision_error');
    expect(store.saved!.value.runtime.invalidDecisionCount).toBe(1);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE-');
    expect(JSON.stringify(controller.getCharacterIssues())).not.toContain('PRIVATE-');
  } finally {
    await controller.close();
  }
});

it('waits longer after each consecutive failed request and recovers without the owner', async () => {
  const store = new MemoryStore();
  let now = epoch;
  const propose = vi.fn(async (): Promise<unknown> => {
    throw new Error('upstream unavailable');
  });
  const controller = await new ElsewhereController(store, {
    now: () => now,
    decisionIntervalMs: 90_000,
    modelProvider: { id: 'fixture', propose },
  }).init();
  const intervalsUntilNextCall = async () => {
    const calls = propose.mock.calls.length;
    for (let waited = 1; waited <= 40; waited++) {
      now += 90_000;
      await controller.step();
      if (propose.mock.calls.length > calls) return waited;
    }
    return Infinity;
  };
  try {
    await controller.step();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) waits.push(await intervalsUntilNextCall());
    // One interval, doubling per failure, never more than sixteen: the character keeps trying.
    expect(waits).toEqual([1, 2, 4, 8, 16, 16]);
    expect(controller.getCharacterIssues()).toMatchObject([
      { kind: 'failed', code: 'decision_error', retrying: true },
    ]);
    expect(controller.getSnapshot().runtime.modelStatus).toBe(
      'Model provider unavailable; trying again automatically',
    );
    expect(controller.getSnapshot().character.activity).toBe('Currently unavailable');
    expect(store.saved!.value.hubert.turn).toBe(0);
    propose.mockImplementation(async () => ({ action: { type: 'reflect' }, why: '' }));
    expect(await intervalsUntilNextCall()).toBe(16);
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(now);
    expect(store.saved!.value.runtime.providerFailureCount).toBe(0);
    expect(store.saved!.value.runtime.providerRetryAt).toBeUndefined();
    // A later failure starts again from a single interval.
    propose.mockRejectedValueOnce(new Error('upstream unavailable'));
    expect(await intervalsUntilNextCall()).toBe(1);
    expect(controller.getCharacterIssues().at(-1)).toMatchObject({
      kind: 'failed',
      retrying: true,
    });
    expect(await intervalsUntilNextCall()).toBe(1);
    expect(controller.getCharacterIssues().at(-1)!.resolvedAt).toBe(now);
  } finally {
    await controller.close();
  }
});

it('lets the owner skip the wait after a failed request', async () => {
  const store = new MemoryStore();
  const propose = vi
    .fn()
    .mockRejectedValueOnce(new Error('upstream unavailable'))
    .mockResolvedValue({ action: { type: 'reflect' }, why: '' });
  const controller = await new ElsewhereController(store, {
    now: () => epoch,
    modelProvider: { id: 'fixture', propose },
  }).init();
  try {
    await controller.step();
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(1);
    await controller.retryCharacterProvider();
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(2);
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(epoch);
  } finally {
    await controller.close();
  }
});

it('checks an unavailable provider once per interval without spending a call and resumes when it returns', async () => {
  const store = new MemoryStore();
  let now = epoch;
  let available = false;
  const propose = vi.fn(async (): Promise<unknown> => ({ action: { type: 'reflect' }, why: '' }));
  const controller = await new ElsewhereController(store, {
    now: () => now,
    modelProvider: { id: 'fixture', propose, isAvailable: () => available },
  }).init();
  try {
    for (let i = 0; i < 5; i++) await controller.step();
    const waiting = controller.getCharacterIssues();
    expect(waiting).toMatchObject([{ kind: 'unavailable', retrying: true, lastAt: epoch }]);
    expect(waiting[0].message).toContain('Hubert will try again automatically');
    now += 90_000;
    await controller.step();
    expect(controller.getCharacterIssues()).toMatchObject([{ kind: 'unavailable', lastAt: now }]);
    expect(propose).not.toHaveBeenCalled();
    expect(controller.getSnapshot().runtime.modelCalls).toBe(0);
    available = true;
    now += 90_000;
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(1);
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(now);
  } finally {
    await controller.close();
  }
});

it('continues by itself once the daily allowance resets', async () => {
  const store = new MemoryStore();
  let now = epoch;
  const propose = vi.fn(async (): Promise<unknown> => ({ action: { type: 'reflect' }, why: '' }));
  const controller = await new ElsewhereController(store, {
    now: () => now,
    modelMaximum: 1,
    modelProvider: { id: 'fixture', propose },
  }).init();
  try {
    await controller.step();
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(1);
    expect(controller.getCharacterIssues()).toMatchObject([{ kind: 'allowance', retrying: true }]);
    expect(controller.getCharacterIssues()[0].message).toContain('will continue when it resets');
    now += 86_400_000;
    await controller.step();
    expect(propose).toHaveBeenCalledTimes(2);
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(now);
  } finally {
    await controller.close();
  }
});

const brokerProvider = (fetcher: typeof fetch, now: () => number) =>
  new BrokerDecisionProvider(
    new BrokerModelClient({
      baseUrl: 'https://inference.example',
      token: 'fixture-service-credential-'.repeat(2),
      expectedBinding: {
        worldId: 'elsewhere',
        ownerUserId: 'fixture-owner',
        characterId: 'hubert',
        connectionId: 'fixture-plan',
      },
      fetcher,
      now,
    }),
  );

it('keeps the stated reason while a service stays away after its daily limit, spends nothing, and resumes at the reset', async () => {
  const store = new MemoryStore();
  let now = epoch;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: 'daily_limit', retryAfterMs: 600_000 }, { status: 429 }),
    )
    .mockImplementation(async () =>
      Response.json({ value: { action: { type: 'reflect' }, why: '' } }),
    );
  const controller = await new ElsewhereController(store, {
    now: () => now,
    modelProvider: brokerProvider(fetcher, () => now),
  }).init();
  try {
    await controller.step();
    expect(controller.getCharacterIssues()).toMatchObject([
      { kind: 'failed', code: 'daily_limit', retrying: true },
    ]);
    for (let i = 0; i < 6; i++) {
      now += 90_000;
      await controller.step();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(controller.getCharacterIssues()).toMatchObject([
      { kind: 'unavailable', code: 'daily_limit', retrying: true, lastAt: now },
    ]);
    now += 90_000;
    await controller.step();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(now);
  } finally {
    await controller.close();
  }
});

it('reports refused access as needing the owner, rechecks it without a request, and recovers on retry after repair', async () => {
  const store = new MemoryStore();
  let now = epoch;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'not_authorized' }, { status: 403 }))
    .mockImplementation(async () =>
      Response.json({ value: { action: { type: 'reflect' }, why: '' } }),
    );
  const controller = await new ElsewhereController(store, {
    now: () => now,
    modelProvider: brokerProvider(fetcher, () => now),
  }).init();
  try {
    for (let i = 0; i < 20; i++) {
      await controller.step();
      const [issue] = controller.getCharacterIssues();
      expect(issue).toMatchObject({ kind: 'unavailable', code: 'not_authorized' });
      expect(issue.retrying).toBeUndefined();
      expect(issue.message).toContain('Check the connection or sign-in, then retry');
      now += 90_000;
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().runtime.modelStatus).toBe('Hubert is currently unavailable');
    await controller.retryCharacterProvider();
    await controller.step();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(now);
  } finally {
    await controller.close();
  }
});

it('releases a failure stored by an earlier release that waited for the owner', async () => {
  const store = new MemoryStore();
  const failing = await new ElsewhereController(store, {
    now: () => epoch,
    modelProvider: {
      id: 'fixture',
      propose: async () => {
        throw new Error('upstream unavailable');
      },
    },
  }).init();
  await failing.step();
  await failing.close();
  // Earlier releases stored the failure without a scheduled attempt and stopped there.
  const runtime = store.saved!.value.runtime;
  delete runtime.providerIssues![0].retrying;
  delete runtime.providerRetryAt;
  delete runtime.providerFailureCount;
  const propose = vi.fn(async (): Promise<unknown> => ({ action: { type: 'reflect' }, why: '' }));
  const next = await new ElsewhereController(store, {
    now: () => epoch,
    simulationStepMs: 30_000,
    modelProvider: { id: 'fixture', propose },
  }).init();
  try {
    for (let ticks = 0; ticks < 10 && !propose.mock.calls.length; ticks++) await next.tick();
    expect(propose).toHaveBeenCalledTimes(1);
    expect(next.getCharacterIssues()[0].resolvedAt).toBe(epoch);
  } finally {
    await next.close();
  }
});
