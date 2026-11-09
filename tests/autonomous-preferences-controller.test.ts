import { expect, it } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import { SqliteSnapshotStore, type SnapshotStore } from '../packages/persistence/src/index';
import { applyInterestChoice } from '../characters/hubert/src/interestChoices';
import { applyOutcome, chooseAction, createInitialHubert } from '../characters/hubert/src/index';
import {
  createInitialWorld,
  executeWorldCommand,
  observeWorld,
} from '../elsewhere/server/src/world';

const now = Date.UTC(2026, 10, 9, 12);
it('lets a model choose to set aside a known taste without erasing its genuine encounters', async () => {
  const backing = new SqliteSnapshotStore<ControllerState>(':memory:');
  const initial = await new ElsewhereController(backing, { now: () => now }).init();
  const saved = (await backing.load())!;
  saved.value.hubert.interests = [{ id: 'sound', name: 'Sound', strength: 0.7, encounters: 3 }];
  await backing.save(saved.value, saved.version);
  const store: SnapshotStore<ControllerState> = {
    load: () => backing.load(),
    save: (value, version) => backing.save(value, version),
    close: () => backing.close(),
  };
  const c = await new ElsewhereController(store, {
    now: () => now,
    modelProvider: {
      id: 'fixture',
      propose: async (context) => {
        expect(context.state.interestChoices).toContainEqual({
          interestId: 'sound',
          name: 'Sound',
          disposition: 'set-aside',
        });
        return { type: 'reconsider', interestId: 'sound', disposition: 'set-aside' };
      },
    },
  }).init();
  void initial;
  try {
    const snapshot = await c.step();
    const state = (await backing.load())!.value;
    expect(snapshot.events.at(-1)?.type).toBe('interest_changed');
    expect(snapshot.character.interests).toEqual([]);
    expect(state.hubert.dormantInterests[0]).toMatchObject({ id: 'sound', encounters: 3 });
    expect(state.hubert.interestChoices?.choices).toBe(1);
    expect(state.modelAllowance.calls).toBe(1);
    expect(state.hubert.memories).toEqual(saved.value.hubert.memories);
  } finally {
    await c.close();
  }
});
it('allows a new encounter to add evidence without automatically undoing a deliberate pause', () => {
  const world = createInitialWorld(now);
  const object = world.objects.find((o) => o.id === 'artifact')!;
  object.tags = ['mechanism'];
  world.entities = [];
  const resident = world.residents[0];
  resident.position = { x: object.position.x, z: object.position.z + 1 };
  resident.facing = Math.PI;
  let state = createInitialHubert(now);
  state.knownObjects[object.id] = object;
  state.interests = [{ id: 'mechanism', name: 'Mechanisms', strength: 0.6, encounters: 4 }];
  state = applyInterestChoice(
    state,
    { interestId: 'mechanism', disposition: 'set-aside' },
    now,
  ).state;
  const result = executeWorldCommand(
    world,
    'hubert',
    { type: 'inspect', targetId: object.id },
    now,
  );
  expect(result.outcome.status).toBe('completed');
  state = applyOutcome(state, result.outcome, observeWorld(result.world, 'hubert'), now);
  expect(state.interests.some((i) => i.id === 'mechanism')).toBe(false);
  expect(state.dormantInterests.find((i) => i.id === 'mechanism')?.encounters).toBe(5);
  expect(state.memories).toHaveLength(1);
});
it('develops an unassigned taste from an actual reachable encounter', () => {
  const world = createInitialWorld(now);
  const object = world.objects.find((o) => o.id === 'artifact')!;
  object.tags = ['mechanism'];
  world.objects = [object];
  world.entities = [];
  world.obstacles = [];
  const resident = world.residents[0];
  resident.position = { x: object.position.x, z: object.position.z + 1 };
  resident.facing = Math.PI;
  const fresh = createInitialHubert(now);
  expect(fresh.interests).toEqual([]);
  const decision = chooseAction(fresh, observeWorld(world, 'hubert'), now);
  const actual = executeWorldCommand(world, 'hubert', decision.action, now);
  expect(actual.outcome.status).toBe('completed');
  const state = applyOutcome(
    decision.state,
    actual.outcome,
    observeWorld(actual.world, 'hubert'),
    now,
  );
  expect(state.interests).toEqual([
    { id: 'mechanism', name: 'Mechanism', strength: 0.3, encounters: 1 },
  ]);
  expect(state.interests.some((i) => i.id === 'birds')).toBe(false);
});
