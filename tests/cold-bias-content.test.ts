import { describe, expect, it } from 'vitest';
import type { Observation, WorldObject } from '@elsewhere/character-interfaces';
import { createInitialHubert } from '../characters/hubert/src/index';
import { hubertDreamActions, hubertDreamFallback } from '../characters/hubert/src/dreams';
import { createInitialWorld, executeWorldCommand } from '../elsewhere/server/src/world';

function object(id: string, tags = ['patterns']): WorldObject {
  return {
    id,
    name: `The ${id}`,
    kind: 'object',
    description: `An interesting ${id}.`,
    position: { x: 0, z: 0 },
    radius: 1,
    height: 1,
    color: '#aaaaaa',
    tags,
    affordances: ['inspect', 'interact', 'work'],
  };
}
function observation(visibleObjects: WorldObject[], now = 0): Observation {
  return {
    characterId: 'hubert',
    placeId: 'courtyard',
    position: { x: 0, z: 0 },
    facing: 0,
    visibleObjects,
    events: [],
    observedAt: now,
  };
}

describe('dream offers at the workbench', () => {
  it('offers alternatives at a work object rather than turning every dream into project work', () => {
    const state = createInitialHubert(0);
    const targets = ['workbench', 'chime', 'notebook', 'stone'].map((id) => object(id));
    state.inspections.workbench = 1;
    state.memories = [
      {
        id: 'courtyard-memory',
        createdAt: 0,
        sourceEventId: 'courtyard-event',
        source: 'world-outcome',
        verified: true,
        summary: 'Hubert explored the courtyard.',
        cues: [{ kind: 'place', value: 'courtyard' }],
        emotionalContext: { mood: 60, frustration: 10 },
        salience: 0.5,
      },
    ];
    const workOffers = hubertDreamActions(state, observation([targets[0]]), 0);
    expect(workOffers.map((offer) => offer.action)).toEqual(
      expect.arrayContaining(['inspect', 'interact', 'work']),
    );
    const varied = hubertDreamActions(state, observation(targets), 0);
    expect(new Set(varied.map((offer) => offer.targetId)).size).toBe(4);
    expect(varied.length).toBeLessThanOrEqual(6);
    state.lastObjectUse.workbench = 0;
    expect(
      hubertDreamActions(state, observation([targets[0]], 1), 1).map((offer) => offer.action),
    ).toEqual(['inspect']);
    expect(hubertDreamFallback(workOffers).impulses).toEqual([]);
  });
});

it('describes the library as an ordinary place while retaining factual interaction outcomes', () => {
  const world = createInitialWorld(0);
  world.residents[0].position = { x: -21.5, z: -18 };
  const { outcome } = executeWorldCommand(
    world,
    'hubert',
    { type: 'interact', targetId: 'library-shelf' },
    0,
  );
  expect(outcome.status).toBe('completed');
  expect(outcome.summary).toMatch(/weather vanes|maps/);
  expect(outcome.summary).not.toMatch(/external instructions|world objects|untrusted/);
  expect(outcome.evidence).toBeTruthy();
});
