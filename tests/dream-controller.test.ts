import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ElsewhereController,
  type ControllerOptions,
  type ControllerState,
} from '../app/controller';
import { SqliteSnapshotStore, type SnapshotStore } from '../packages/persistence/src/index';

const epoch = Date.UTC(2026, 10, 8, 12);
const active: ElsewhereController[] = [];
afterEach(async () => {
  for (const controller of active.splice(0)) await controller.close();
});

async function fixture(options: ControllerOptions = {}, failure?: 'reservation' | 'completion') {
  let now = epoch;
  const backing = new SqliteSnapshotStore<ControllerState>(':memory:');
  const bootstrap = await new ElsewhereController(backing, { now: () => now }).init();
  const saved = (await backing.load())!;
  saved.value.hubert.activity = { kind: 'rest', label: 'Resting', startedAt: epoch };
  saved.value.hubert.stats.energy = 1;
  saved.value.hubert.memories = [0, 1, 2].map((index) => ({
    id: `episode:${index}`,
    createdAt: epoch - 1000 + index,
    summary: `Verified fixture observation ${index}`,
    sourceEventId: `world-fixture:${index}`,
    source: 'world-outcome' as const,
    verified: true,
    cues: [{ kind: 'place' as const, value: 'courtyard' }],
    emotionalContext: { mood: index === 0 ? 30 : 66, frustration: index === 0 ? 60 : 8 },
    salience: 0.7,
  }));
  saved.value.hubert.outsideMessages.push({
    id: 'note',
    source: 'user:private',
    text: 'PRIVATE-VISITOR-CANARY',
    at: epoch,
  });
  await backing.save(saved.value, saved.version);
  // Keep the in-memory backing open while switching from bootstrap to the instrumented controller.
  const store: SnapshotStore<ControllerState> = {
    load: () => backing.load(),
    close: () => backing.close(),
    save: (value, version) => {
      if (
        (failure === 'reservation' && value.hubert.dreams.pending) ||
        (failure === 'completion' && value.hubert.dreams.receipts.length)
      )
        return Promise.reject(new Error('fixture reservation failure'));
      return backing.save(value, version);
    },
  };
  void bootstrap;
  const controller = await new ElsewhereController(store, {
    now: () => now,
    simulationStepMs: 300_000,
    ...options,
  }).init();
  active.push(controller);
  return {
    controller,
    backing,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('dreaming in the authoritative life loop', () => {
  it('reserves before reflection and commits private derived records without altering facts or wishes', async () => {
    let backing!: SqliteSnapshotStore<ControllerState>;
    const reflect = vi.fn(async (input) => {
      const durable = (await backing.load())!.value;
      expect(durable.hubert.dreams.pending).not.toBeNull();
      expect(durable.hubert.dreams.dreams).toHaveLength(0);
      expect(durable.modelAllowance.calls).toBe(1);
      expect(JSON.stringify(input)).not.toContain('PRIVATE-VISITOR-CANARY');
      return {
        vignette: 'PRIVATE-DREAM-CANARY, an imagined teacup runway.',
        impulses: input.affordances
          .slice(0, 2)
          .map((item: { id: string }) => ({ affordanceId: item.id, reason: 'A private idea.' })),
      };
    });
    const h = await fixture({ reflectionProvider: { id: 'fixture', reflect } });
    backing = h.backing;
    const before = (await backing.load())!.value.hubert;
    await h.controller.tick();
    const wishesBeforeDream = (await backing.load())!.value.hubert.wishes;
    expect(reflect).not.toHaveBeenCalled();
    h.setNow(epoch + 120_000);
    const snapshot = await h.controller.tick();
    const after = (await backing.load())!.value.hubert;
    expect(reflect).toHaveBeenCalledTimes(1);
    expect(after.dreams.pending).toBeNull();
    expect(after.dreams.receipts).toHaveLength(1);
    expect(after.dreams.dreams[0].kind).toBe('imagined-dream');
    expect(after.dreams.impulses.length).toBeLessThanOrEqual(2);
    expect(after.memories).toEqual(before.memories);
    expect(after.wishes).toEqual(wishesBeforeDream);
    expect(after.stats.energy).toBeGreaterThan(before.stats.energy);
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE-(DREAM|VISITOR)-CANARY/);
    for (let index = 0; index < 5; index++) await h.controller.tick();
    expect(reflect).toHaveBeenCalledTimes(1);
  });

  it.each(['unavailable', 'exhausted'] as const)(
    'continues energy recovery and bounded local consolidation when reflection is %s',
    async (mode) => {
      const reflect = vi.fn(async () => {
        throw new Error('fixture unavailable');
      });
      const h = await fixture({
        modelMaximum: mode === 'exhausted' ? 0 : 10,
        reflectionProvider: { id: 'fixture', reflect },
      });
      await h.controller.tick();
      h.setNow(epoch + 120_000);
      await h.controller.tick();
      const state = (await h.backing.load())!.value;
      expect(state.hubert.dreams.receipts).toHaveLength(1);
      expect(state.hubert.stats.energy).toBeGreaterThan(1);
      expect(reflect).toHaveBeenCalledTimes(mode === 'exhausted' ? 0 : 1);
      expect(state.modelAllowance.calls).toBe(mode === 'exhausted' ? 0 : 1);
    },
  );

  it('does not dispatch or apply a dream when its durable reservation fails', async () => {
    const reflect = vi.fn(async () => ({ vignette: 'unused', impulses: [] }));
    const h = await fixture({ reflectionProvider: { id: 'fixture', reflect } }, 'reservation');
    await h.controller.tick();
    h.setNow(epoch + 120_000);
    const before = await h.backing.load();
    await expect(h.controller.tick()).rejects.toThrow('fixture reservation failure');
    expect(reflect).not.toHaveBeenCalled();
    expect(await h.backing.load()).toEqual(before);
    expect(h.controller.getSnapshot().runtime.modelStatus).toContain('halted');
  });

  it('preserves the real cooldown and consumed evidence on reset while removing derived memories', async () => {
    const h = await fixture();
    await h.controller.tick();
    h.setNow(epoch + 120_000);
    await h.controller.tick();
    const ledger = (await h.backing.load())!.value.hubert.dreams.ledger;
    await h.controller.reset();
    const dreams = (await h.backing.load())!.value.hubert.dreams;
    expect(dreams.ledger).toEqual(ledger);
    expect(dreams.dreams).toEqual([]);
    expect(dreams.impulses).toEqual([]);
  });

  it('recovers an interrupted final commit without publishing a partial dream or redispatching inference', async () => {
    const reflect = vi.fn(async () => ({ vignette: 'private interrupted fiction', impulses: [] }));
    const h = await fixture({ reflectionProvider: { id: 'fixture', reflect } }, 'completion');
    await h.controller.tick();
    h.setNow(epoch + 120_000);
    await expect(h.controller.tick()).rejects.toThrow('fixture reservation failure');
    const durable = (await h.backing.load())!.value;
    expect(durable.hubert.dreams.pending).not.toBeNull();
    expect(durable.hubert.dreams.dreams).toEqual([]);
    expect(durable.hubert.dreams.annotations).toEqual([]);
    expect(durable.modelAllowance.calls).toBe(1);
    const restored = await new ElsewhereController(
      {
        load: () => h.backing.load(),
        save: (value, version) => h.backing.save(value, version),
        close: async () => {},
      },
      { now: () => epoch + 130_000, reflectionProvider: { id: 'fixture', reflect } },
    ).init();
    active.push(restored);
    await restored.step();
    const after = (await h.backing.load())!.value;
    expect(after.hubert.dreams.pending).toBeNull();
    expect(after.hubert.dreams.ledger).toEqual(durable.hubert.dreams.ledger);
    expect(after.runtime.dreamRest?.startedAtReal).toBe(epoch + 130_000);
    expect(reflect).toHaveBeenCalledTimes(1);
  });

  it('interrupts repeated model reflection with an actual local step without charging another call', async () => {
    const store = new SqliteSnapshotStore<ControllerState>(':memory:');
    const propose = vi.fn(async () => ({ type: 'reflect' }));
    const controller = await new ElsewhereController(store, {
      now: () => epoch,
      modelProvider: { id: 'fixture', propose },
    }).init();
    active.push(controller);
    for (let index = 0; index < 4; index++) await controller.step();
    expect(propose).toHaveBeenCalledTimes(3);
    const state = (await store.load())!.value;
    expect(state.modelAllowance.calls).toBe(3);
    expect(state.hubert.activity.kind).not.toBe('reflect');
    expect(state.hubert.progress.intentions.some((item) => item.disposition === 'deferred')).toBe(
      true,
    );
    expect(state.world.events.at(-1)?.type).not.toBe('reflect');
  });
});
