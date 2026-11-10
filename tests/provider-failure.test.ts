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

  it('retains one private failure through restart and resumes only after an owner-requested successful retry', async () => {
    const store = new MemoryStore();
    let now = epoch;
    const propose = vi
      .fn()
      .mockRejectedValueOnce(new Error('PRIVATE-PROVIDER-SECRET-CANARY'))
      .mockResolvedValue({ type: 'reflect' });
    const options = { now: () => now, modelProvider: { id: 'fixture', propose } };
    const first = await new ElsewhereController(store, options).init();
    await first.step();
    const issues = first.getCharacterIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'failed', since: epoch });
    expect(JSON.stringify(first.getSnapshot())).not.toContain('PRIVATE-');
    expect(JSON.stringify(issues)).not.toContain('PRIVATE-');
    await first.close();
    const restarted = await new ElsewhereController(store, options).init();
    try {
      now += 86_400_000;
      for (let i = 0; i < 20; i++) await restarted.step();
      expect(propose).toHaveBeenCalledTimes(1);
      expect(restarted.getCharacterIssues()).toEqual(issues);
      await restarted.retryCharacterProvider();
      expect(restarted.getCharacterIssues()[0].resolvedAt).toBeUndefined();
      await restarted.tick();
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
    .mockImplementation(async () => Response.json({ value: { type: 'reflect' } }));
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
    .mockResolvedValue(Response.json({ value: { type: 'reflect' } }));
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
      type: 'inspect',
      targetId: 'unknown-fixture-target',
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
    propose.mockResolvedValue({ type: 'reflect' });
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
    .mockResolvedValueOnce({ type: 'inspect', targetId: 'unknown-fixture-target' });
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

it('a real request failure interrupts automatic action correction immediately and keeps errors private', async () => {
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
    expect(issue.retrying).toBeUndefined();
    expect(issue.code).toBe('decision_error');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE-');
    expect(JSON.stringify(controller.getCharacterIssues())).not.toContain('PRIVATE-');
  } finally {
    await controller.close();
  }
});
