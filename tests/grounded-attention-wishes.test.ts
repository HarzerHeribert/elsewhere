import { describe, expect, it, vi } from 'vitest';
import type {
  CharacterCommand,
  Observation,
  WorldObject,
} from '../characters/interfaces/src/index';
import type { EpisodicMemory } from '../characters/runtime/src/index';
import {
  createInitialHubert,
  type HubertDecision,
  type HubertState,
} from '../characters/hubert/src/index';
import { followThrough, trackHubertIntent } from '../characters/hubert/src/attention';
import { considerWish } from '../characters/hubert/src/wishes';
import { createInitialWorld, observeWorld } from '../elsewhere/server/src/world';

const epoch = Date.UTC(2026, 10, 9, 12);
const bench: WorldObject = {
  id: 'workbench',
  name: 'The workbench',
  kind: 'workbench',
  description: 'A place for small experiments.',
  position: { x: 0, z: 5 },
  radius: 0.5,
  height: 1,
  color: '#999',
  tags: ['making', 'weather'],
  affordances: ['inspect', 'work', 'interact'],
};
function setup() {
  const state = createInitialHubert(epoch);
  state.knownObjects.workbench = structuredClone(bench);
  const observation: Observation = {
    characterId: 'hubert',
    placeId: 'courtyard',
    position: { x: 0, z: 0 },
    facing: 0,
    visibleObjects: [structuredClone(bench)],
    events: [],
    observedAt: epoch,
  };
  return { state, observation };
}
function reflectRepeatedly(state: HubertState, observation?: Observation) {
  for (let index = 0; index < 4; index++) {
    state.turn++;
    const now = epoch + index * 90000;
    trackHubertIntent(
      state,
      { type: 'reflect' },
      now,
      observation && { ...observation, observedAt: now },
    );
  }
}
function recorders() {
  return {
    recordIntent: vi.fn(
      (state: HubertState, action: CharacterCommand, explanation: string): HubertDecision => ({
        state,
        action,
        explanation,
      }),
    ),
    recordWatchIntent: vi.fn(),
    chooseVisibleEntity: vi.fn(() => undefined),
  };
}
function memory(index: number, overrides: Partial<EpisodicMemory> = {}): EpisodicMemory {
  return {
    id: 'meaningful-' + index,
    sourceEventId: 'source-' + index,
    createdAt: epoch + index,
    summary: 'A distinct observation of mechanism ' + index,
    source: 'world-outcome',
    verified: true,
    experience: { action: 'inspect', targetId: 'mechanism-' + index, status: 'completed' },
    cues: [{ kind: 'place', value: 'courtyard' }],
    emotionalContext: { mood: 60, frustration: 5 },
    salience: 0.5,
    ...overrides,
  };
}

describe('current opportunities and grounded follow-through', () => {
  it('does not count reflection without current perception as missed feasible opportunities', () => {
    const absent = setup();
    reflectRepeatedly(absent.state);
    expect(absent.state.progress.unresolvedOpportunities).toBe(0);
    expect(absent.state.progressGuidance).toBeNull();
    const hidden = setup();
    reflectRepeatedly(hidden.state, { ...hidden.observation, visibleObjects: [] });
    expect(hidden.state.progress.unresolvedOpportunities).toBe(0);
    expect(hidden.state.progressGuidance).toBeNull();
  });

  it('does not assign generic reflection to an untouched weather project when another real object catches attention', () => {
    const { state, observation } = setup();
    observation.visibleObjects.push({
      ...bench,
      id: 'garden',
      name: 'The garden',
      position: { x: 0, z: 1 },
      affordances: ['inspect', 'interact'],
    });
    reflectRepeatedly(state, observation);
    expect(state.progressGuidance).toMatchObject({
      intentionKey: 'object:garden',
      smallestStep: { type: 'inspect', targetKey: 'garden' },
    });
    expect(
      state.progress.intentions.some((intention) => intention.key === 'project:weather-study'),
    ).toBe(false);
  });

  it('keeps a genuinely underway project grounded in its own current prerequisite', () => {
    const { state, observation } = setup();
    state.project.verifiedWorkSessions = 1;
    reflectRepeatedly(state, observation);
    expect(state.progressGuidance).toMatchObject({
      intentionKey: 'project:weather-study',
      smallestStep: { type: 'move', targetKey: 'workbench' },
    });
  });

  it('offers a visible distant workbench as an approach, not an immediately possible inspection', () => {
    const { state, observation } = setup();
    reflectRepeatedly(state, observation);
    expect(state.progressGuidance).toMatchObject({
      kind: 'shrink',
      reason: 'repeated-deliberation',
      smallestStep: { type: 'move', targetKey: 'workbench' },
    });
    const handlers = recorders();
    const result = followThrough(state, observation, epoch + 360000, handlers);
    expect(result?.action).toEqual({ type: 'move', targetId: 'workbench' });
    expect(handlers.recordIntent).toHaveBeenCalledTimes(1);
  });

  it('offers an admitted immediate activity when the target really is close and ready', () => {
    const { state, observation } = setup();
    observation.visibleObjects[0].position = { x: 0, z: 1 };
    reflectRepeatedly(state, observation);
    expect(state.progressGuidance?.smallestStep).toEqual({
      type: 'inspect',
      targetKey: 'workbench',
    });
  });

  it('does not turn a temporary cooldown into invented readiness or a new failure', () => {
    const { state, observation } = setup();
    state.inspections.workbench = 1;
    state.lastObjectUse.workbench = epoch;
    observation.visibleObjects[0].position = { x: 0, z: 1 };
    for (let index = 0; index < 4; index++) {
      state.turn++;
      trackHubertIntent(state, { type: 'reflect' }, epoch + index * 1000, observation);
    }
    expect(state.progress.unresolvedOpportunities).toBe(0);
    expect(state.progressGuidance).toBeNull();
  });

  it('records an invalid place inspection as blocked while preserving the actual private blocker', () => {
    const { state, observation } = setup();
    observation.knownPlaces = [{ id: 'meadow', name: 'The meadow', position: { x: 10, z: 10 } }];
    state.turn++;
    trackHubertIntent(state, { type: 'inspect', targetId: 'meadow' }, epoch, observation);
    expect(state.progressGuidance).toMatchObject({
      kind: 'defer',
      reason: 'blocked',
      targetKey: 'meadow',
    });
    expect(state.progressGuidance?.retryCondition).toContain('destination');
  });

  it('rechecks a restored shrink hint and never executes an unseen remembered inspection', () => {
    const { state, observation } = setup();
    state.progressGuidance = {
      kind: 'shrink',
      reason: 'repeated-deliberation',
      intentionKey: 'project:weather-study',
      targetKey: 'workbench',
      count: 3,
      alternativesLimit: 2,
      smallestStep: { type: 'inspect', targetKey: 'workbench' },
    };
    const handlers = recorders();
    const result = followThrough(state, { ...observation, visibleObjects: [] }, epoch, handlers);
    expect(result?.action).toEqual({ type: 'move', targetId: 'workbench' });
    expect(result?.explanation).toContain('Move closer');
    expect(handlers.recordIntent.mock.calls.some(([, action]) => action.type === 'inspect')).toBe(
      false,
    );
  });

  it('allows a new visible object to catch attention before automatically detouring to a creature', () => {
    const { state, observation } = setup();
    const fresh = {
      ...bench,
      id: 'fresh-stone',
      name: 'An unfamiliar stone',
      position: { x: 0, z: 1 },
      affordances: ['inspect'],
    };
    observation.visibleObjects.push(fresh);
    state.progressGuidance = {
      kind: 'defer',
      reason: 'repeated-failure',
      intentionKey: 'project:weather-study',
      targetKey: 'workbench',
      count: 3,
      alternativesLimit: 2,
    };
    const handlers = recorders();
    const result = followThrough(state, observation, epoch, handlers);
    expect(result?.action).toEqual({ type: 'inspect', targetId: 'fresh-stone' });
    expect(handlers.chooseVisibleEntity).not.toHaveBeenCalled();
  });

  it('does not label a research capability available merely because its topic is a known object', () => {
    const { state, observation } = setup();
    for (let index = 0; index < 4; index++) {
      state.turn++;
      trackHubertIntent(
        state,
        { type: 'research', targetId: 'workbench' },
        epoch + index * 1000,
        observation,
      );
    }
    expect(state.progress.unresolvedOpportunities).toBe(0);
    expect(state.progressGuidance).toBeNull();
  });
});

describe('wishes need meaningful completed experiences', () => {
  it('does not create a wish from three failed commands, including legacy diagnostic-only records', () => {
    const { state } = setup();
    state.memories = [
      memory(1, {
        summary: 'Move closer before interacting with that object.',
        experience: { action: 'interact', targetId: 'workbench', status: 'rejected' },
      }),
      memory(2, { summary: 'That object does not exist.', experience: undefined }),
      memory(3, {
        summary: 'That object is outside the resident’s line of sight.',
        experience: undefined,
      }),
    ];
    const before = structuredClone(state.memories);
    const world = createInitialWorld(epoch);
    expect(considerWish(state, observeWorld(world, 'hubert'), epoch, world).wishes).toEqual([]);
    expect(state.memories).toEqual(before);
  });

  it('counts legacy nondiagnostic experiences and keeps failed private sources out of the wish explanation', () => {
    const { state } = setup();
    const world = createInitialWorld(epoch);
    state.interests = [{ id: 'mechanism', name: 'Mechanisms', strength: 0.7, encounters: 2 }];
    for (const id of ['artifact', 'lookout-telescope'])
      state.knownObjects[id] = world.objects.find((object) => object.id === id)!;
    state.memories = [
      memory(1, { experience: undefined }),
      memory(2, {
        experience: { action: 'inspect', targetId: 'artifact', status: 'completed' },
        cues: [{ kind: 'object', value: 'artifact' }],
      }),
      memory(3, {
        experience: { action: 'inspect', targetId: 'lookout-telescope', status: 'completed' },
        cues: [{ kind: 'object', value: 'lookout-telescope' }],
      }),
      memory(4, {
        experience: { action: 'inspect', targetId: 'missing', status: 'rejected' },
        summary: 'PRIVATE-BLOCKER',
      }),
    ];
    const result = considerWish(state, observeWorld(world, 'hubert'), epoch, world);
    expect(result.wishes).toHaveLength(1);
    expect(result.wishes[0].requestedObjectId).toBe('magnifying-glass');
    expect(result.wishes[0].sourceMemoryIds).toEqual(['meaningful-2', 'meaningful-3']);
    expect(JSON.stringify(result.wishes)).not.toContain('PRIVATE-BLOCKER');
    expect(result.memories.at(-1)?.summary).toBe('PRIVATE-BLOCKER');
  });

  it('does not count external readings or repeated copies of one receipt toward the three-experience gate', () => {
    const { state } = setup();
    const first = memory(1);
    state.memories = [
      first,
      { ...first, id: 'duplicate-receipt' },
      memory(2, {
        source: 'web-reading',
        reference: {
          url: 'https://example.com/birds',
          title: 'A source',
          retrievedAt: epoch,
          excerpt: 'Public but unverified outside information.',
        },
      }),
    ];
    const world = createInitialWorld(epoch);
    expect(considerWish(state, observeWorld(world, 'hubert'), epoch, world).wishes).toEqual([]);
  });
});
