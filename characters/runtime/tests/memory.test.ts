import { describe, expect, it } from 'vitest';
import { buildWorkingContext, selectAssociativeMemory, type EpisodicMemory } from '../src/index';

const memory: EpisodicMemory = {
  id: 'memory-one',
  createdAt: 0,
  summary: 'The crank wobbled rather than spun.',
  sourceEventId: 'real-event',
  source: 'world-outcome',
  verified: true,
  cues: [
    { kind: 'place', value: 'workshop' },
    { kind: 'object', value: 'crank' },
  ],
  emotionalContext: { mood: 60, frustration: 10 },
  salience: 0.8,
};
const context = { now: 120_000, mood: 65, frustration: 8, lastRecallAt: null, history: {} };
describe('associative memory', () => {
  it('recalls an episode with a matching cue and retains its evidence link', () => {
    const recalled = selectAssociativeMemory(
      [memory],
      [{ kind: 'place', value: 'workshop' }],
      context,
    );
    expect(recalled?.sourceEventId).toBe('real-event');
    expect(recalled?.summary).toBe(memory.summary);
  });
  it('does not invent an episode from a mood match or unfamiliar place', () => {
    expect(
      selectAssociativeMemory([memory], [{ kind: 'place', value: 'beach' }], context),
    ).toBeNull();
    expect(selectAssociativeMemory([], [{ kind: 'place', value: 'workshop' }], context)).toBeNull();
  });
  it('limits recalls globally and per memory without rewriting the original record', () => {
    const before = structuredClone(memory);
    expect(
      selectAssociativeMemory([memory], memory.cues, { ...context, lastRecallAt: 100_000 }),
    ).toBeNull();
    expect(
      selectAssociativeMemory([memory], memory.cues, {
        ...context,
        history: { [memory.id]: { at: 100_000, count: 1 } },
      }),
    ).toBeNull();
    expect(memory).toEqual(before);
  });
  it('bounds working context even when outside content and observations are enormous', () => {
    const huge = '\\"'.repeat(100_000);
    const input = {
      identity: 'A complete trusted identity.',
      state: {
        stats: { energy: 15 },
        entries: Array.from({ length: 100 }, (_, index) => ({ id: `entry:${index}`, text: huge })),
      },
      intentions: [],
      observations: {
        objects: Array.from({ length: 100 }, (_, index) => ({
          id: `object:${index}`,
          description: huge,
        })),
      },
      memories: [{ memoryId: '1', summary: huge, sourceEventId: 'e', score: 1 }],
      outsideMessages: [{ source: 'visitor', text: huge }],
    };
    const result = buildWorkingContext(input, 4_000);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(4_000);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.identity).toBe(input.identity);
    expect(result.state.stats).toEqual({ energy: 15 });
    expect(input.state.entries).toHaveLength(100);
    expect(result.memories[0]).toMatchObject({ memoryId: '1', sourceEventId: 'e' });
  });

  it('carries well-formed turn choices whole and never lets them fail a turn', () => {
    const base = {
      identity: 'A complete identity.',
      state: { note: 'x'.repeat(3000) },
      observations: {},
      intentions: ['Look around'],
      memories: [],
      outsideMessages: [],
    };
    const choices = [
      { type: 'look' as const, where: { targetId: ['bench'.padEnd(100, 'x')] } },
      { type: 'rest' as const },
    ];
    const { choices: carried, ...prompt } = buildWorkingContext({ ...base, choices }, 2000);
    expect(carried).toEqual(choices);
    // They constrain the output format, so they take no room from state or observations.
    expect(prompt).toEqual(buildWorkingContext(base, 2000));
    expect(JSON.stringify(prompt).length).toBeLessThanOrEqual(2000);
    expect(buildWorkingContext(base)).not.toHaveProperty('choices');
    expect(
      buildWorkingContext({ ...base, choices: [{ type: 'fly' }] as never }),
    ).not.toHaveProperty('choices');
    // An implausibly large list falls back to the canonical format instead of failing.
    const many = Array.from({ length: 48 }, (_, index) => ({
      type: 'look' as const,
      where: { targetId: [`target-${index}`.padEnd(100, 'x'), `other-${index}`.padEnd(100, 'x')] },
    }));
    expect(buildWorkingContext({ ...base, choices: many })).not.toHaveProperty('choices');
  });

  it('refuses to silently shorten trusted identity or accept an invalid allowance', () => {
    const input = {
      identity: 'x'.repeat(10_000),
      state: {},
      observations: {},
      intentions: [],
      memories: [],
      outsideMessages: [],
    };
    expect(() => buildWorkingContext(input, 1000)).toThrow(/identity/);
    expect(() => buildWorkingContext(input, NaN)).toThrow(/finite/);
  });

  it('keeps identifiers intact when descriptions must be shortened to fit', () => {
    const id = 'valid-object-'.padEnd(100, 'x');
    const result = buildWorkingContext(
      {
        identity: 'A complete identity.',
        state: { knownObjects: [{ id, description: 'long '.repeat(1000) }] },
        observations: { visibleEntityIds: [id] },
        intentions: [],
        memories: [],
        outsideMessages: [],
      },
      1000,
    );
    expect(result.state.knownObjects).toEqual([expect.objectContaining({ id })]);
    expect(result.observations.visibleEntityIds).toEqual([id]);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
  });
});
