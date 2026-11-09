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
