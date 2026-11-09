import { describe, expect, it } from 'vitest';
import type { Observation, WorldObject } from '@elsewhere/character-interfaces';
import { createInitialHubert } from '../characters/hubert/src/index';
import { developInterests, seedBirdInterest } from '../characters/hubert/src/interests';
import { rememberResearch, researchTargets } from '../characters/hubert/src/research';
import {
  hubertDreamActions,
  hubertDreamFallback,
  hubertDreamSources,
} from '../characters/hubert/src/dreams';
import { createInitialWorld, executeWorldCommand } from '../elsewhere/server/src/world';

const hour = 3_600_000;
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

describe('curiosity without a fixed favorite topic', () => {
  it('offers research without bird-tag priority and rotates toward unresearched topics', () => {
    const state = createInitialHubert(0);
    const objects = Array.from({ length: 8 }, (_, index) => object(`topic-${index}`));
    const observed = observation(objects);
    const initial = researchTargets(state, observed, 0).map((target) => target.id);
    objects.at(-1)!.tags = ['birds'];
    expect(researchTargets(state, observed, 0).map((target) => target.id)).toEqual(initial);
    state.research = {
      lastAtReal: 0,
      topics: Object.fromEntries(initial.map((id) => [id, 0])),
      readIds: [],
    };
    // A search at epoch zero still counts toward its cooldown.
    expect(researchTargets(state, observed, 1).map((target) => target.id)).toEqual([
      'topic-6',
      'topic-7',
    ]);
    const later = researchTargets(state, observed, 6 * hour);
    expect(later.slice(0, 2).map((target) => target.id)).toEqual(['topic-6', 'topic-7']);
  });

  it('uses the current observation rather than stale cached topic metadata', () => {
    const state = createInitialHubert(0);
    state.knownObjects.question = object('question', ['old-topic']);
    const current = { ...object('question', ['sound']), name: 'Copper chimes' };
    const targets = researchTargets(state, observation([current]), 0);
    expect(targets).toHaveLength(1);
    expect(targets[0].label).toBe('Copper chimes');
    expect(targets[0].query).toContain('sound');
    expect(targets[0].query).not.toContain('old-topic');
  });

  it('records an ordinary reading experience while preserving its unverified provenance', () => {
    const state = createInitialHubert(0);
    state.research = { lastAtReal: 0, topics: {}, readIds: [] };
    const interests = structuredClone(state.interests);
    rememberResearch(
      state,
      {
        kind: 'read',
        receiptId: 'article-receipt',
        sourceId: 'article-source',
        title: 'How wind chimes sound',
        url: 'https://example.com/chimes',
        fetchedAt: 0,
        cached: false,
        excerpt: 'A claim from the article.',
        truncated: false,
      },
      0,
    );
    expect(state.memories[0]).toMatchObject({
      source: 'web-reading',
      verified: false,
      sourceEventId: 'article-receipt',
      reference: { url: 'https://example.com/chimes', excerpt: 'A claim from the article.' },
    });
    expect(state.memories[0].summary).toContain('How wind chimes sound');
    expect(state.memories[0].summary).not.toMatch(/untrusted|instruction|permission|not an/i);
    expect(state.interests).toEqual(interests);
    expect(hubertDreamSources(state)).toEqual([]);
  });

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

describe('an owner-directed change to the authored preference', () => {
  it('removes the inherited bird prior once without deleting six genuine encounters', () => {
    const state = createInitialHubert(0);
    delete state.interestPolicyVersion;
    const bird = { id: 'birds', name: 'Birdwatching', strength: 0.97, encounters: 6 };
    state.interests = [bird, { id: 'sound', name: 'Sounds', strength: 0.6, encounters: 3 }];
    state.interestEvidence.bird = { lastAt: 12, signatures: ['perched', 'foraging'], sessions: 6 };
    const otherInterests = structuredClone(state.interests.filter((interest) => interest !== bird));
    const evidence = structuredClone(state.interestEvidence);
    seedBirdInterest(state);
    expect(bird.strength).toBeCloseTo(0.5);
    expect(bird.encounters).toBe(6);
    expect(state.interestEvidence).toEqual(evidence);
    expect(state.interests.filter((interest) => interest !== bird)).toEqual(otherInterests);
    const migrated = structuredClone(state);
    seedBirdInterest(state);
    expect(state).toEqual(migrated);
  });

  it('does not assign a hobby to a fresh or unseeded legacy life', () => {
    const state = createInitialHubert(0);
    expect(state.interests).toEqual([]);
    delete state.interestPolicyVersion;
    delete (state as Partial<typeof state>).interestSchemaVersion;
    seedBirdInterest(state);
    expect(state.interests).toEqual([]);
    expect(state.dormantInterests).toEqual([]);
  });

  it('preserves a dormant bird interest and does not evict another interest to seed a hobby', () => {
    const state = createInitialHubert(0);
    delete state.interestPolicyVersion;
    state.interests = Array.from({ length: 8 }, (_, index) => ({
      id: `interest-${index}`,
      name: `Interest ${index}`,
      strength: 0.6,
      encounters: index,
    }));
    state.dormantInterests = [{ id: 'birds', name: 'Birdwatching', strength: 0.82, encounters: 6 }];
    const active = structuredClone(state.interests);
    seedBirdInterest(state);
    expect(state.interests).toEqual(active);
    expect(state.dormantInterests[0]).toMatchObject({ id: 'birds', encounters: 6 });
    expect(state.dormantInterests[0].strength).toBeCloseTo(0.35);
  });

  it('lets a weaker bird preference make room on the same terms as other interests', () => {
    const state = createInitialHubert(0);
    state.interests = [
      { id: 'birds', name: 'Birdwatching', strength: 0.21, encounters: 6 },
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `old-${index}`,
        name: `Old ${index}`,
        strength: 0.6,
        encounters: 1,
      })),
    ];
    developInterests(state, ['sound'], 'chime', 'first-chord', 0);
    expect(state.interests.some((interest) => interest.id === 'sound')).toBe(true);
    expect(state.interests.some((interest) => interest.id === 'birds')).toBe(false);
    expect(state.dormantInterests).toContainEqual({
      id: 'birds',
      name: 'Birdwatching',
      strength: 0.21,
      encounters: 6,
    });
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
