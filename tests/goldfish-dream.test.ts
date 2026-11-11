import { describe, expect, it, vi } from 'vitest';
import {
  applyOutcome,
  chooseActionWithProvider,
  createInitialHubert,
} from '../characters/hubert/src/index';
import {
  dreamActionCommand,
  hubertDreamActions,
  hubertDreamInterpretations,
  hubertDreamSources,
} from '../characters/hubert/src/dreams';
import {
  beginDreamConsolidation,
  completeDreamConsolidation,
  toDreamSource,
  type EpisodicMemory,
} from '../characters/runtime/src/index';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  observeWorld,
} from '../elsewhere/server/src/world';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';

const epoch = Date.UTC(2026, 10, 8, 12);
function episode(index: number, overrides: Partial<EpisodicMemory> = {}): EpisodicMemory {
  return {
    id: `goldfish-episode:${index}`,
    createdAt: epoch - 1000 + index,
    summary: `Verified observation ${index}`,
    sourceEventId: `goldfish-outcome:${index}`,
    source: 'world-outcome',
    verified: true,
    cues: [{ kind: 'place', value: 'pond' }],
    emotionalContext: { mood: 65, frustration: 10 },
    salience: 0.5,
    ...overrides,
  };
}

function dreamFixture() {
  const now = epoch + 2 * 86_400_000;
  const state = createInitialHubert(now);
  const world = createInitialWorld(now);
  const observation = observeWorld(world, 'hubert', now);
  state.memories = [1, 2, 3].map((index) =>
    episode(index, {
      createdAt: now - 1000 + index,
      cues: [{ kind: 'place', value: observation.placeId }],
    }),
  );
  const sources = hubertDreamSources(state);
  const reserved = beginDreamConsolidation({
    state: state.dreams,
    sources,
    rest: {
      id: 'goldfish-rest',
      voluntary: true,
      startedAt: now - 300_000,
      endedAt: now,
      startedAtReal: epoch - 120_000,
      endedAtReal: epoch,
    },
    nowReal: epoch,
  });
  const actions = hubertDreamActions(state, observation, epoch, sources);
  expect(actions.length).toBeGreaterThan(0);
  const action = actions[0];
  state.dreams = completeDreamConsolidation({
    state: reserved.state,
    requestKey: reserved.request!.idempotencyKey,
    currentSources: sources,
    proposal: {
      vignette: 'A private imagined runway.',
      impulses: [{ affordanceId: action.id, reason: 'A small experiment.' }],
    },
    nowReal: epoch,
    availableActions: actions,
  }).state;
  expect(state.dreams.impulses).toHaveLength(1);
  return { state, world, observation, action, now };
}

class MemoryStore implements SnapshotStore<ControllerState> {
  saved: StoredSnapshot<ControllerState> | null = null;
  failFinalDream = false;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: ControllerState, expectedVersion: number) {
    if (this.failFinalDream && value.hubert.dreams.receipts.length)
      throw new Error('final dream commit failed');
    expect(expectedVersion).toBe(this.saved?.version ?? 0);
    const version = expectedVersion + 1;
    this.saved = { version, value: structuredClone(value) };
    return version;
  }
  async close() {}
}

describe('fresh-context dream integration regressions', () => {
  it('does not treat a happier unrelated activity in the same place as contrary evidence', () => {
    const failed = episode(1, {
      emotionalContext: { mood: 20, frustration: 60 },
      experience: { action: 'inspect', targetId: 'duck', status: 'rejected' },
    });
    const unrelated = episode(2, {
      emotionalContext: { mood: 85, frustration: 0 },
      experience: { action: 'inspect', targetId: 'bench', status: 'completed' },
    });
    expect(
      hubertDreamInterpretations([failed, unrelated].map((item) => toDreamSource(item)))[0],
    ).toMatchObject({ status: 'unresolved', retrievalOffset: 0, sourceIds: [failed.id] });
    const changed = episode(3, {
      experience: { action: 'inspect', targetId: 'duck', status: 'completed' },
    });
    expect(
      hubertDreamInterpretations([failed, changed].map((item) => toDreamSource(item)))[0],
    ).toMatchObject({ status: 'active', retrievalOffset: -0.15 });
  });

  it('retains a rejected world attempt as an unchanged factual dream source without rewarding it', () => {
    const state = createInitialHubert(epoch);
    const world = createInitialWorld(epoch);
    const observation = observeWorld(world, 'hubert', epoch);
    const rejected = executeWorldCommand(
      world,
      'hubert',
      { type: 'inspect', targetId: 'missing' },
      epoch,
    );
    expect(rejected.outcome.status).toBe('rejected');
    const after = applyOutcome(state, rejected.outcome, observation, epoch, epoch);
    expect(hubertDreamSources(after)).toEqual([
      expect.objectContaining({
        sourceEventId: rejected.outcome.id,
        summary: rejected.outcome.summary,
        verified: true,
        experience: { action: 'inspect', targetId: 'missing', status: 'rejected' },
      }),
    ]);
    expect(after.stats.energy).toBe(state.stats.energy);
    expect(after.stats.mood).toBe(state.stats.mood);
    expect(after.project).toEqual(state.project);
    expect(applyOutcome(after, rejected.outcome, observation, epoch, epoch).memories).toHaveLength(
      1,
    );
  });

  it('retains successful entity observation metadata for evidence-based reconsideration', () => {
    const state = createInitialHubert(epoch);
    const world = createInitialWorld(epoch);
    const result = executeWorldCommand(
      world,
      'hubert',
      { type: 'inspect', targetId: 'courtyard-sparrow' },
      epoch,
    );
    expect(result.outcome.status).toBe('completed');
    const after = applyOutcome(
      state,
      result.outcome,
      observeWorld(result.world, 'hubert', epoch),
      epoch,
      epoch,
    );
    expect(hubertDreamSources(after)[0].experience).toEqual({
      action: 'inspect',
      targetId: 'courtyard-sparrow',
      status: 'completed',
    });
  });

  it('recognizes admitted walks as actual attempts rather than aimless project hopping', async () => {
    let now = epoch;
    let state = createInitialHubert(now);
    let world = createInitialWorld(now);
    for (const targetId of world.places.map((place) => place.id)) {
      now += 120_000;
      world = advanceWorld(world, now);
      const decision = await chooseActionWithProvider(
        state,
        observeWorld(world, 'hubert', now),
        now,
        { id: 'fixture', propose: async () => ({ action: { type: 'move', targetId }, why: '' }) },
        epoch,
      );
      expect(decision.action).toEqual({ type: 'move', targetId });
      const result = executeWorldCommand(world, 'hubert', decision.action, now);
      expect(result.outcome.status).toBe('started');
      world = result.world;
      state = applyOutcome(
        decision.state,
        result.outcome,
        observeWorld(world, 'hubert', now),
        now,
        epoch,
      );
      expect(state.progressGuidance).toBeNull();
      expect(state.progress.unresolvedOpportunities).toBe(0);
    }
  });

  it('does not replace an unavailable provider destination with a dream impulse', async () => {
    const h = dreamFixture();
    await expect(
      chooseActionWithProvider(
        h.state,
        h.observation,
        h.now,
        {
          id: 'fixture',
          propose: async () => ({
            action: { type: 'move', targetId: 'unknown-destination' },
            why: '',
          }),
        },
        epoch,
      ),
    ).rejects.toThrow('Provider proposed an unavailable action');
    expect(h.state.activeWakeImpulse).toBeNull();
  });

  it('settles a model-selected waking impulse through the normal world receipt', async () => {
    const h = dreamFixture();
    const command = dreamActionCommand(h.action)!;
    const decision = await chooseActionWithProvider(
      h.state,
      h.observation,
      h.now,
      { id: 'fixture', propose: async () => ({ action: command, why: '' }) },
      epoch,
    );
    expect(decision.state.activeWakeImpulse).toBe(h.state.dreams.impulses[0].id);
    const result = executeWorldCommand(h.world, 'hubert', command, h.now);
    const after = applyOutcome(decision.state, result.outcome, h.observation, h.now, epoch);
    expect(after.dreams.impulses[0].status).toBe('completed');
    expect(after.activeWakeImpulse).toBeNull();
  });

  it('keeps a failed final dream commit private and consumes its reservation across restart', async () => {
    let now = epoch;
    const store = new MemoryStore();
    const bootstrap = await new ElsewhereController(store, { now: () => now }).init();
    const seeded = (await store.load())!;
    seeded.value.hubert.activity = { kind: 'rest', label: 'Resting', startedAt: epoch };
    seeded.value.hubert.stats.energy = 1;
    seeded.value.hubert.memories = [1, 2, 3].map((index) => episode(index));
    await store.save(seeded.value, seeded.version);
    await bootstrap.close();
    const reflect = vi.fn(async () => ({ vignette: 'PRIVATE-FAILED-COMMIT-CANARY', impulses: [] }));
    const controller = await new ElsewhereController(store, {
      now: () => now,
      simulationStepMs: 300_000,
      reflectionProvider: { id: 'fixture', reflect },
      modelProvider: {
        id: 'rest-fixture',
        localOnly: true,
        managesAllowance: true,
        propose: async () => ({ action: { type: 'rest' }, why: '' }),
      },
    }).init();
    await controller.tick();
    now += 120_000;
    store.failFinalDream = true;
    await expect(controller.tick()).rejects.toThrow('final dream commit failed');
    expect(reflect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE-FAILED-COMMIT-CANARY');
    expect(controller.getSnapshot().runtime.modelStatus).toContain('halted');
    const interrupted = (await store.load())!.value;
    expect(interrupted.hubert.dreams.pending).not.toBeNull();
    expect(interrupted.hubert.dreams.receipts).toHaveLength(0);
    expect(interrupted.modelAllowance.calls).toBe(1);
    await controller.close();
    store.failFinalDream = false;
    const restarted = await new ElsewhereController(store, {
      now: () => now,
      simulationStepMs: 300_000,
      reflectionProvider: { id: 'fixture', reflect },
      modelProvider: {
        id: 'rest-fixture',
        localOnly: true,
        managesAllowance: true,
        propose: async () => ({ action: { type: 'rest' }, why: '' }),
      },
    }).init();
    expect((await store.load())!.value.hubert.dreams.pending).toBeNull();
    expect((await store.load())!.value.hubert.dreams.ledger).toEqual(
      interrupted.hubert.dreams.ledger,
    );
    await restarted.tick();
    now += 120_000;
    await restarted.tick();
    expect(reflect).toHaveBeenCalledTimes(1);
    expect((await store.load())!.value.modelAllowance.calls).toBe(1);
    await restarted.close();
  });

  it('does not claim zero known cost when reflection can use a remote provider', async () => {
    const controller = await new ElsewhereController(new MemoryStore(), {
      now: () => epoch,
      modelProvider: {
        id: 'local-fixture',
        localOnly: true,
        propose: async () => ({ action: { type: 'look' }, why: '' }),
      },
      reflectionProvider: {
        id: 'remote-fixture',
        localOnly: false,
        reflect: async () => ({ vignette: 'An imagined duck.', impulses: [] }),
      },
    }).init();
    expect(controller.getSnapshot().runtime.costKnown).toBe(false);
    await controller.close();
  });
});
