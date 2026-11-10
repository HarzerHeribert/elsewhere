import { describe, expect, it } from 'vitest';
import { appendTrail, createInitialHubert, type TrailEntry } from './index';

const at = Date.UTC(2026, 10, 10, 12);
const step = (id: string, offset: number, extra: Partial<TrailEntry> = {}): TrailEntry => ({
  id,
  at: at + offset,
  kind: 'look',
  why: 'The bench is worth a look.',
  placeId: 'courtyard',
  ...extra,
});

describe('appendTrail', () => {
  it('counts a step repeated word for word on the entry before it', () => {
    let state = createInitialHubert(at);
    state = appendTrail(state, step('a', 0));
    state = appendTrail(state, step('b', 1000));
    state = appendTrail(state, step('c', 2000));
    expect(state.trail).toEqual([{ ...step('a', 2000), times: 3 }]);
  });

  it('lists a step again when its reason, text or place differs', () => {
    let state = createInitialHubert(at);
    state = appendTrail(state, step('a', 0));
    state = appendTrail(state, step('b', 1000, { why: 'Something moved under it.' }));
    state = appendTrail(
      state,
      step('c', 2000, { why: 'Something moved under it.', placeId: 'pond' }),
    );
    state = appendTrail(state, step('d', 3000));
    expect(state.trail.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(state.trail.every((entry) => entry.times === undefined)).toBe(true);
  });
});
