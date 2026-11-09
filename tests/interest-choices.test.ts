import { describe, expect, it } from 'vitest';
import {
  createInitialHubert,
  type HubertInterest,
  type HubertState,
} from '../characters/hubert/src/index';
import {
  applyInterestChoice,
  availableInterestChoices,
  INTEREST_CHOICE_LIMITS,
  type HubertInterestChoiceState,
} from '../characters/hubert/src/interestChoices';

const epoch = Date.UTC(2026, 10, 9, 12);
const hour = 3_600_000;
const topic = (id: string, encounters = 3, strength = 0.4): HubertInterest => ({
  id,
  name: id + ' interest',
  strength,
  encounters,
});
function fixture(): HubertState & { interestChoices?: HubertInterestChoiceState } {
  const state = createInitialHubert(epoch);
  state.interests = [topic('mechanisms', 7, 0.62), topic('birds', 9, 0.77)];
  state.dormantInterests = [topic('gardening', 4, 0.06)];
  state.interestEvidence = {
    'garden-source': { lastAt: epoch, signatures: ['a-real-encounter'], sessions: 4 },
  };
  state.memories = [
    {
      id: 'real-memory',
      createdAt: epoch,
      summary: 'An actual recorded encounter.',
      sourceEventId: 'real-world-event',
      source: 'world-outcome',
      verified: true,
      cues: [],
      emotionalContext: { mood: 64, frustration: 5 },
      salience: 0.5,
    },
  ];
  return state;
}

describe('character-owned interest choices', () => {
  it('offers only existing topics and actual changes of focus, without prescribing a favorite', () => {
    const state = fixture();
    const offers = availableInterestChoices(state, epoch);
    expect(offers).toEqual([
      { interestId: 'mechanisms', name: 'mechanisms interest', disposition: 'set-aside' },
      { interestId: 'birds', name: 'birds interest', disposition: 'set-aside' },
      { interestId: 'gardening', name: 'gardening interest', disposition: 'pursue' },
    ]);
    expect(state).not.toHaveProperty('interestChoices');
  });

  it('lets Hubert park birdwatching without deleting its history, then explicitly resume it after the cooldown', () => {
    const before = fixture();
    const original = structuredClone(before);
    const parked = applyInterestChoice(
      before,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch,
    );
    expect(parked.status).toBe('changed');
    expect(before).toEqual(original);
    expect(parked.state.interests.map((interest) => interest.id)).toEqual(['mechanisms']);
    expect(parked.state.dormantInterests.find((interest) => interest.id === 'birds')).toEqual(
      original.interests[1],
    );
    expect(parked.state.interestChoices).toMatchObject({
      day: '2026-11-09',
      choices: 1,
      lastDispositions: { birds: 'set-aside' },
    });
    expect(
      availableInterestChoices(parked.state, epoch + 6 * hour - 1).some(
        (offer) => offer.interestId === 'birds',
      ),
    ).toBe(false);
    expect(
      applyInterestChoice(
        parked.state,
        { interestId: 'birds', disposition: 'pursue' },
        epoch + 6 * hour - 1,
      ).status,
    ).toBe('unavailable');
    const resumed = applyInterestChoice(
      parked.state,
      { interestId: 'birds', disposition: 'pursue' },
      epoch + 6 * hour,
    );
    expect(resumed.status).toBe('changed');
    expect(resumed.state.interests.find((interest) => interest.id === 'birds')).toEqual(
      original.interests[1],
    );
    expect(resumed.state.interestChoices).toMatchObject({
      choices: 2,
      lastDispositions: { birds: 'pursue' },
    });
    for (const key of [
      'stats',
      'memories',
      'interestEvidence',
      'dreams',
      'project',
      'journal',
    ] as const)
      expect(resumed.state[key]).toEqual(original[key]);
  });

  it('restores a dormant preference to viable attention without inventing encounters or an emotional reward', () => {
    const state = fixture();
    const resumed = applyInterestChoice(
      state,
      { interestId: 'gardening', disposition: 'pursue' },
      epoch,
    );
    expect(resumed.status).toBe('changed');
    expect(resumed.state.interests.find((interest) => interest.id === 'gardening')).toMatchObject({
      strength: INTEREST_CHOICE_LIMITS.resumedStrength,
      encounters: 4,
    });
    expect(resumed.state.stats).toEqual(state.stats);
    expect(resumed.state.interestEvidence).toEqual(state.interestEvidence);
    expect(resumed.state.memories).toEqual(state.memories);
  });

  it('does not boost an active preference or consume allowance when a completed choice is replayed', () => {
    const state = fixture();
    const noOp = applyInterestChoice(state, { interestId: 'birds', disposition: 'pursue' }, epoch);
    expect(noOp.status).toBe('unchanged');
    expect(noOp.state.interestChoices?.choices).toBe(0);
    expect(noOp.state.interests).toEqual(state.interests);
    const parked = applyInterestChoice(
      state,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch,
    );
    const replay = applyInterestChoice(
      parked.state,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch + 1,
    );
    expect(replay.status).toBe('unchanged');
    expect(replay.state.interestChoices?.choices).toBe(1);
    expect(
      replay.state.dormantInterests.filter((interest) => interest.id === 'birds'),
    ).toHaveLength(1);
  });

  it('keeps the daily ceiling across serialization/restart and refills only on a later real UTC day', () => {
    let state = fixture();
    state.interests = Array.from({ length: 5 }, (_, index) => topic('known-' + index));
    state.dormantInterests = [];
    for (let index = 0; index < 4; index++) {
      const result = applyInterestChoice(
        state,
        { interestId: 'known-' + index, disposition: 'set-aside' },
        epoch + index,
      );
      expect(result.status).toBe('changed');
      state = JSON.parse(JSON.stringify(result.state));
    }
    expect(state.interestChoices?.choices).toBe(4);
    expect(availableInterestChoices(state, epoch + 8 * hour)).toEqual([]);
    const denied = applyInterestChoice(
      state,
      { interestId: 'known-4', disposition: 'set-aside' },
      epoch + 8 * hour,
    );
    expect(denied.status).toBe('unavailable');
    expect(denied.state.interestChoices?.choices).toBe(4);
    const next = applyInterestChoice(
      state,
      { interestId: 'known-4', disposition: 'set-aside' },
      epoch + 24 * hour,
    );
    expect(next.status).toBe('changed');
    expect(next.state.interestChoices).toMatchObject({ day: '2026-11-10', choices: 1 });
  });

  it('clamps a backwards clock after a new-day commit rather than restoring allowance or bypassing topic cooldowns', () => {
    const state = fixture();
    const first = applyInterestChoice(
      state,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch,
    );
    const nextDay = applyInterestChoice(
      first.state,
      { interestId: 'birds', disposition: 'pursue' },
      epoch + 24 * hour,
    );
    expect(nextDay.status).toBe('changed');
    const rollback = applyInterestChoice(
      nextDay.state,
      { interestId: 'mechanisms', disposition: 'set-aside' },
      epoch - hour,
    );
    expect(rollback.status).toBe('changed');
    expect(rollback.state.interestChoices).toMatchObject({
      day: '2026-11-10',
      latestAtReal: epoch + 24 * hour,
      choices: 2,
    });
    const tooSoon = applyInterestChoice(
      rollback.state,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch + hour,
    );
    expect(tooSoon.status).toBe('unavailable');
    expect(tooSoon.state.interestChoices?.choices).toBe(2);
  });

  it('rejects invented topics without generating interests, encounters or choices', () => {
    const state = fixture();
    const result = applyInterestChoice(
      state,
      { interestId: 'cryptocurrency-speculation', disposition: 'pursue' },
      epoch,
    );
    expect(result.status).toBe('unavailable');
    expect(result.state.interestChoices?.choices).toBe(0);
    expect(result.state.interests).toEqual(state.interests);
    expect(result.state.dormantInterests).toEqual(state.dormantInterests);
  });

  it('does not evict another preference automatically to make room for a resume', () => {
    const state = fixture();
    state.interests = Array.from({ length: 8 }, (_, index) => topic('active-' + index));
    expect(
      availableInterestChoices(state, epoch).every((offer) => offer.disposition === 'set-aside'),
    ).toBe(true);
    const denied = applyInterestChoice(
      state,
      { interestId: 'gardening', disposition: 'pursue' },
      epoch,
    );
    expect(denied.status).toBe('unavailable');
    expect(denied.state.interests).toEqual(state.interests);
    expect(denied.state.interestChoices?.choices).toBe(0);
  });

  it('can set aside every active interest without replacing it with an assigned hobby', () => {
    let state = fixture();
    state.dormantInterests = [];
    for (const interestId of ['mechanisms', 'birds'])
      state = applyInterestChoice(state, { interestId, disposition: 'set-aside' }, epoch).state;
    expect(state.interests).toEqual([]);
    expect(state.dormantInterests).toHaveLength(2);
    expect(availableInterestChoices(state, epoch)).toEqual([]);
    expect(
      availableInterestChoices(state, epoch + 6 * hour).every(
        (offer) => offer.disposition === 'pursue',
      ),
    ).toBe(true);
  });

  it('retains the existing archive and last deliberate disposition beyond the cooldown', () => {
    const state = fixture();
    state.dormantInterests = Array.from({ length: 64 }, (_, index) =>
      topic('archived-' + index, index + 1),
    );
    const result = applyInterestChoice(
      state,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch,
    );
    expect(result.state.dormantInterests.slice(0, 64)).toEqual(state.dormantInterests);
    expect(result.state.dormantInterests).toHaveLength(65);
    const after = applyInterestChoice(
      result.state,
      { interestId: 'mechanisms', disposition: 'pursue' },
      epoch + 24 * hour,
    );
    expect(after.state.interestChoices?.lastDispositions.birds).toBe('set-aside');
  });

  it('keeps an ambiguous duplicate record unavailable rather than erasing either record', () => {
    const state = fixture();
    state.dormantInterests.push(topic('birds', 11));
    expect(
      availableInterestChoices(state, epoch).some((offer) => offer.interestId === 'birds'),
    ).toBe(false);
    const result = applyInterestChoice(
      state,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch,
    );
    expect(result.status).toBe('unavailable');
    expect(result.state.interests).toEqual(state.interests);
    expect(result.state.dormantInterests).toEqual(state.dormantInterests);
  });

  it('bounds choice bookkeeping without discarding an archived interest or mismatching disposition records', () => {
    const state = fixture();
    const history = Array.from(
      { length: 72 },
      (_, index) => ['old-topic-' + index, epoch - (index + 1) * 86400000] as const,
    );
    state.interestChoices = {
      version: 1,
      latestAtReal: epoch,
      day: '2026-11-09',
      choices: 0,
      lastByInterest: Object.fromEntries(history),
      lastDispositions: Object.fromEntries(history.map(([id]) => [id, 'set-aside' as const])),
    };
    const result = applyInterestChoice(
      state,
      { interestId: 'birds', disposition: 'set-aside' },
      epoch,
    );
    expect(result.status).toBe('changed');
    expect(Object.keys(result.state.interestChoices!.lastByInterest)).toHaveLength(72);
    expect(Object.keys(result.state.interestChoices!.lastDispositions)).toEqual(
      Object.keys(result.state.interestChoices!.lastByInterest),
    );
    expect(result.state.interestChoices!.lastDispositions.birds).toBe('set-aside');
    expect(result.state.dormantInterests.find((interest) => interest.id === 'gardening')).toEqual(
      state.dormantInterests[0],
    );
  });

  it('fails closed on a corrupt counter/fence and rejects invalid real-time inputs', () => {
    const state = fixture();
    for (const now of [NaN, Infinity, -1, 0.5])
      expect(() => availableInterestChoices(state, now)).toThrow('wall-clock');
    const corrupt = state as typeof state & { interestChoices?: HubertInterestChoiceState };
    corrupt.interestChoices = {
      version: 1,
      latestAtReal: epoch,
      day: '2026-11-09',
      choices: 99,
      lastByInterest: {},
      lastDispositions: {},
    };
    expect(() => availableInterestChoices(corrupt, epoch)).toThrow('persisted');
    expect(() =>
      applyInterestChoice(corrupt, { interestId: 'birds', disposition: 'set-aside' }, epoch),
    ).toThrow('persisted');
  });
});
