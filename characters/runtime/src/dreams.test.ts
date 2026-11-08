import { describe, expect, it } from 'vitest';
import {
  DREAM_INTERVAL_MS,
  DREAM_MAX_SOURCES,
  abandonDreamConsolidation,
  beginDreamConsolidation,
  completeDreamConsolidation,
  createDreamState,
  dreamRankingOffsets,
  pruneDreamState,
  toDreamSource,
  updateWakeImpulse,
  wakingDreamImpulses,
  type DreamAction,
  type DreamProposal,
  type DreamRestSession,
  type DreamSource,
  type DreamState,
} from './dreams';

const nowReal = 10_000_000;
const rest: DreamRestSession = {
  id: 'rest-1',
  voluntary: true,
  startedAt: 1_000_000,
  endedAt: 1_300_000,
  startedAtReal: nowReal - 120_000,
  endedAtReal: nowReal,
};
function episode(index: number, overrides: Partial<DreamSource> = {}): DreamSource {
  return toDreamSource(
    {
      id: `episode-${index}`,
      sourceEventId: `outcome-${index}`,
      createdAt: 100_000 + index,
      source: 'world-outcome',
      verified: true,
      summary:
        index === 1
          ? 'The duck flew away when I approached.'
          : 'A bird remained nearby while I watched quietly.',
      cues: [{ kind: 'place', value: 'pond' }],
      emotionalContext: { mood: index === 1 ? 20 : 65, frustration: index === 1 ? 60 : 5 },
      salience: 0.8,
      ...overrides,
    },
    overrides.revision ?? `revision-${index}`,
    overrides.recalledCount ?? 0,
  );
}
const sources = [episode(1), episode(2), episode(3)];
const proposal: DreamProposal = {
  vignette: 'In the dream, a duck directed sparrows onto a teacup runway.',
  impulses: [{ affordanceId: 'watch-quietly', reason: 'Try watching quietly from the path.' }],
};
const action: DreamAction = {
  id: 'watch-quietly',
  description: 'Watch quietly from the pond path.',
  targetId: 'pond-path',
  action: 'move',
  sourceIds: ['episode-1', 'episode-2'],
  expiresAtReal: nowReal + 60_000,
  retryCondition: 'Defer if tired or the path is unavailable; retry after waking.',
};
function begin(
  state = createDreamState('hubert'),
  inputSources = sources,
  real = nowReal,
  session = rest,
) {
  return beginDreamConsolidation({ state, sources: inputSources, rest: session, nowReal: real });
}
function complete(state: DreamState, inputSources = sources, real = nowReal, extra = {}) {
  return completeDreamConsolidation({
    state,
    requestKey: state.pending!.idempotencyKey,
    currentSources: inputSources,
    proposal,
    nowReal: real,
    availableActions: [action],
    ...extra,
  });
}
function laterRest(day: number): DreamRestSession {
  return {
    ...rest,
    id: `rest-${day + 1}`,
    startedAtReal: rest.startedAtReal + day * DREAM_INTERVAL_MS,
    endedAtReal: rest.endedAtReal + day * DREAM_INTERVAL_MS,
  };
}

describe('durable dream eligibility and reservation', () => {
  it('reserves a deterministic bounded private source snapshot without mutating the episodes', () => {
    const before = structuredClone(sources);
    const state = createDreamState('hubert');
    const result = begin(state);
    expect(result.reason).toBe('ready');
    expect(result.state.pending?.sources).toHaveLength(3);
    expect(result.state.ledger.lastAttemptAtReal).toBe(nowReal);
    expect(result.state.ledger.consumedSourceEventIds).toEqual(
      expect.arrayContaining(['outcome-1', 'outcome-2', 'outcome-3']),
    );
    expect(begin(state, [...sources].reverse()).request?.idempotencyKey).toBe(
      result.request?.idempotencyKey,
    );
    expect(result.request?.idempotencyKey.length).toBeLessThan(80);
    expect(result.request?.idempotencyKey).not.toContain('duck');
    result.request!.sources[0].summary = 'Changed caller copy';
    expect(result.state.pending?.sources[0].summary).not.toBe('Changed caller copy');
    expect(sources).toEqual(before);
    expect(state.pending).toBeNull();
  });

  it('requires continuous voluntary rest in both real and simulation time', () => {
    for (const changes of [
      { voluntary: false },
      { startedAtReal: nowReal - 119_999 },
      { startedAt: rest.endedAt - 299_999 },
      { endedAtReal: nowReal + 1 },
      { startedAtReal: NaN },
    ])
      expect(begin(undefined, sources, nowReal, { ...rest, ...changes }).reason).toBe(
        'rest-not-qualified',
      );
    expect(begin().reason).toBe('ready');
  });

  it('requires distinct lived events; repeated assertions, revisions and recalls are not evidence', () => {
    const visitorAssertions = sources.map((source) => ({
      ...source,
      source: 'external-message' as const,
      verified: true,
    }));
    expect(begin(undefined, visitorAssertions).reason).toBe('insufficient-new-evidence');
    expect(
      begin(
        undefined,
        sources.map((source) => ({ ...source, verified: false })),
      ).reason,
    ).toBe('insufficient-new-evidence');
    expect(
      begin(
        undefined,
        sources.map((source) => ({ ...source, sourceEventId: 'one-event' })),
      ).reason,
    ).toBe('insufficient-new-evidence');
    const reserved = begin();
    const recovered = abandonDreamConsolidation(JSON.parse(JSON.stringify(reserved.state)));
    expect(
      begin(
        recovered,
        sources.map((source) => ({ ...source, revision: 'new-version', recalledCount: 100 })),
        nowReal + DREAM_INTERVAL_MS,
        laterRest(1),
      ).reason,
    ).toBe('insufficient-new-evidence');
    expect(
      begin(
        recovered,
        sources.map((source) => ({ ...source, id: `${source.id}-paraphrase` })),
        nowReal + DREAM_INTERVAL_MS,
        laterRest(1),
      ).reason,
    ).toBe('insufficient-new-evidence');
  });

  it('does not use experiences that occurred after the selected rest window', () => {
    expect(
      begin(
        undefined,
        sources.map((source) => ({ ...source, createdAt: rest.endedAt + 1 })),
      ).reason,
    ).toBe('insufficient-new-evidence');
  });

  it('does not replenish the real allowance with simulated acceleration or clock rollback', () => {
    const state = abandonDreamConsolidation(begin().state);
    const fresh = [episode(4), episode(5), episode(6)];
    expect(
      begin(state, fresh, nowReal + 1, { ...rest, id: 'fast-sim', endedAt: 1e12 }).reason,
    ).toBe('real-cooldown');
    expect(begin(state, fresh, nowReal - 1, laterRest(1)).reason).toBe('real-cooldown');
    expect(begin(state, fresh, nowReal + DREAM_INTERVAL_MS - 1, laterRest(1)).reason).toBe(
      'real-cooldown',
    );
    expect(begin(state, fresh, nowReal + DREAM_INTERVAL_MS, laterRest(1)).reason).toBe('ready');
  });

  it('cannot re-use or overlap a previously consumed rest session even the following day', () => {
    const state = abandonDreamConsolidation(begin().state);
    const fresh = [episode(4), episode(5), episode(6)];
    expect(
      begin(state, fresh, nowReal + DREAM_INTERVAL_MS, { ...laterRest(1), id: rest.id }).reason,
    ).toBe('rest-already-used');
    expect(
      begin(state, fresh, nowReal + DREAM_INTERVAL_MS, {
        ...laterRest(1),
        startedAtReal: rest.startedAtReal,
      }).reason,
    ).toBe('rest-already-used');
  });

  it('reserves before dispatch; restart recovery abandons instead of issuing the call again', () => {
    const reserved = JSON.parse(JSON.stringify(begin().state)) as DreamState;
    expect(begin(reserved).reason).toBe('pending');
    const recovered = abandonDreamConsolidation(reserved);
    expect(recovered.pending).toBeNull();
    expect(recovered.ledger).toEqual(reserved.ledger);
    expect(begin(recovered).reason).toBe('real-cooldown');
    expect(
      completeDreamConsolidation({
        state: recovered,
        requestKey: reserved.pending!.idempotencyKey,
        currentSources: sources,
        proposal,
        nowReal,
        availableActions: [action],
      }).reason,
    ).toBe('no-reservation');
  });

  it('selects recent lived evidence and a few older repeatedly recalled experiences, with a strict bound', () => {
    const many = Array.from({ length: 30 }, (_, index) => episode(index + 10));
    const older = episode(1, { createdAt: 1, recalledCount: 20, salience: 0 });
    const selected = begin(undefined, [...many, older]).request!.sources;
    expect(selected).toHaveLength(DREAM_MAX_SOURCES);
    expect(selected.some((source) => source.id === older.id)).toBe(true);
    expect(selected.some((source) => source.id === 'episode-39')).toBe(true);
    expect(begin(undefined, [...many, older].reverse()).request?.idempotencyKey).toBe(
      begin(undefined, [...many, older]).request?.idempotencyKey,
    );
    const consumed = abandonDreamConsolidation(begin(undefined, [...many, older]).state);
    expect(
      begin(consumed, [...many, older], nowReal + DREAM_INTERVAL_MS, laterRest(1)).reason,
    ).toBe('insufficient-new-evidence');
  });

  it('rejects ambiguous or non-finite sources rather than silently rewriting them', () => {
    expect(begin(undefined, [...sources, sources[0]]).reason).toBe('invalid-sources');
    expect(begin(undefined, [episode(1, { salience: NaN }), ...sources.slice(1)]).reason).toBe(
      'invalid-sources',
    );
  });
});

describe('evidence preserving consolidation', () => {
  it('atomically records private imagined content, a receipt and grounded optional impulses', () => {
    const original = structuredClone(sources);
    const reserved = begin().state;
    const result = complete(reserved);
    expect(result.reason).toBe('committed');
    expect(result.state.pending).toBeNull();
    expect(result.state.dreams[0]).toMatchObject({
      kind: 'imagined-dream',
      visibility: 'private',
      vignette: proposal.vignette,
      receiptId: result.receipt!.id,
    });
    expect(result.state.impulses[0]).toMatchObject({
      targetId: 'pond-path',
      action: 'move',
      visibility: 'private',
      version: 1,
      receiptId: result.receipt!.id,
      sourceIds: action.sourceIds,
    });
    expect(result.receipt?.sources.map((source) => source.sourceEventId)).toEqual(
      expect.arrayContaining(['outcome-1']),
    );
    expect(sources).toEqual(original);
    expect(reserved.pending).not.toBeNull();
    expect(result.state).not.toHaveProperty('needs');
    expect(result.state).not.toHaveProperty('wishes');
  });

  it('commits a retried proposal once after a serialization round trip', () => {
    const first = complete(begin().state);
    const stored = JSON.parse(JSON.stringify(first.state)) as DreamState;
    const again = completeDreamConsolidation({
      state: stored,
      requestKey: first.receipt!.idempotencyKey,
      currentSources: sources,
      proposal,
      nowReal,
      availableActions: [action],
    });
    expect(again.reason).toBe('duplicate');
    expect(again.state).toEqual(stored);
    expect(again.state.dreams).toHaveLength(1);
    expect(again.state.impulses).toHaveLength(1);
  });

  it('rejects revised, deleted or silently overwritten sources and keeps the reservation consumed', () => {
    const state = begin().state;
    for (const changed of [
      sources.slice(1),
      [episode(1, { revision: 'revision-new' }), ...sources.slice(1)],
      [episode(1, { summary: 'The duck happily approached.' }), ...sources.slice(1)],
    ]) {
      const result = complete(state, changed);
      expect(result.reason).toBe('stale-sources');
      expect(result.state.pending).toBeNull();
      expect(result.state.dreams).toHaveLength(0);
      expect(result.state.ledger).toEqual(state.ledger);
    }
  });

  it('treats host receipt action, target and outcome metadata as immutable evidence', () => {
    const factual = [
      episode(1, { experience: { action: 'approach', targetId: 'duck-1', status: 'rejected' } }),
      ...sources.slice(1),
    ];
    const reserved = begin(undefined, factual).state;
    factual[0].experience!.targetId = 'caller-mutated-target';
    expect(
      reserved.pending!.sources.find((source) => source.id === 'episode-1')!.experience!.targetId,
    ).toBe('duck-1');
    const original = [
      episode(1, { experience: { action: 'approach', targetId: 'duck-1', status: 'rejected' } }),
      ...sources.slice(1),
    ];
    const committed = complete(reserved, original).state;
    for (const experience of [
      { action: 'watch', targetId: 'duck-1', status: 'rejected' as const },
      { action: 'approach', targetId: 'duck-2', status: 'rejected' as const },
      { action: 'approach', targetId: 'duck-1', status: 'completed' as const },
    ]) {
      const edited = [episode(1, { experience }), ...sources.slice(1)];
      expect(complete(reserved, edited).reason).toBe('stale-sources');
      expect(pruneDreamState(committed, edited).dreams).toHaveLength(0);
    }
    expect(original[0].experience?.status).toBe('rejected');
  });

  it('keeps model numeric influence and fabricated command arguments out of the proposal boundary', () => {
    for (const invalid of [
      { ...proposal, retrievalOffset: 100 },
      {
        ...proposal,
        impulses: [{ affordanceId: action.id, reason: 'try', targetId: 'admin-panel' }],
      },
      { ...proposal, impulses: [null] },
      { ...proposal, vignette: 'x'.repeat(2001) },
      { ...proposal, impulses: Array(3).fill(proposal.impulses[0]) },
    ]) {
      const result = complete(begin().state, sources, nowReal, { proposal: invalid });
      expect(result.reason).toBe('invalid-proposal');
      expect(result.state.dreams).toHaveLength(0);
      expect(result.state.annotations).toHaveLength(0);
    }
  });

  it('revisits an interpretation using contrary evidence while preserving the original failed encounter', () => {
    const result = complete(begin().state, sources, nowReal, {
      interpretations: [
        {
          memoryId: 'episode-1',
          sourceIds: ['episode-1', 'episode-2'],
          text: 'An approach failed once; a quieter observation can have a different outcome.',
          retrievalOffset: -0.1,
          status: 'active',
        },
      ],
    });
    expect(result.state.annotations[0]).toMatchObject({
      kind: 'interpretation',
      memoryId: 'episode-1',
      retrievalOffset: -0.1,
      visibility: 'private',
    });
    expect(dreamRankingOffsets(result.state, sources)).toEqual({ 'episode-1': -0.1 });
    expect(sources[0].summary).toBe('The duck flew away when I approached.');
    expect(sources[0].verified).toBe(true);
  });

  it('bounds absolute host annotations over repeated sessions and requires new linked evidence', () => {
    const annotate = (sourceId: string) => ({
      memoryId: 'episode-1',
      sourceIds: ['episode-1', sourceId],
      text: 'Keep this in proportion.',
      retrievalOffset: 999,
    });
    const first = complete(begin().state, sources, nowReal, {
      interpretations: [annotate('episode-2')],
    });
    expect(dreamRankingOffsets(first.state, sources)).toEqual({ 'episode-1': 0.25 });
    const fresh = [...sources, episode(4), episode(5), episode(6)];
    const next = begin(first.state, fresh, nowReal + DREAM_INTERVAL_MS, laterRest(1));
    const second = complete(next.state, fresh, nowReal + DREAM_INTERVAL_MS, {
      interpretations: [annotate('episode-4')],
      availableActions: [],
    });
    expect(dreamRankingOffsets(second.state, fresh)).toEqual({ 'episode-1': 0.25 });
    const newer = [...fresh, episode(7), episode(8), episode(9)];
    const third = complete(
      begin(second.state, newer, nowReal + 2 * DREAM_INTERVAL_MS, laterRest(2)).state,
      newer,
      nowReal + 2 * DREAM_INTERVAL_MS,
      {
        interpretations: [{ ...annotate('episode-2'), retrievalOffset: -999 }],
        availableActions: [],
      },
    );
    expect(dreamRankingOffsets(third.state, newer)).toEqual({ 'episode-1': 0.25 });
  });

  it('ignores invalid annotation references and makes archived interpretations inert', () => {
    const result = complete(begin().state, sources, nowReal, {
      interpretations: [
        { memoryId: 'unknown', sourceIds: ['unknown'], text: 'invented', retrievalOffset: 0.2 },
        {
          memoryId: 'episode-2',
          sourceIds: ['episode-2'],
          text: 'bad number',
          retrievalOffset: NaN,
        },
        {
          memoryId: 'episode-1',
          sourceIds: ['episode-1', 'episode-2'],
          text: 'Set aside the old generalization.',
          retrievalOffset: -0.2,
          status: 'archived',
        },
      ],
    });
    expect(result.state.annotations).toHaveLength(1);
    expect(dreamRankingOffsets(result.state, sources)).toEqual({});
  });
});

describe('optional waking preferences and retention', () => {
  it('filters unavailable, expired, ambiguous and unsupported actions; cannot turn a claim into an action source', () => {
    const external = episode(4, { source: 'external-message', verified: false });
    const all = [...sources, external];
    const reserved = begin(undefined, all).state;
    for (const actions of [
      [],
      [{ ...action, expiresAtReal: nowReal }],
      [action, action],
      [{ ...action, sourceIds: ['unknown'] }],
      [{ ...action, sourceIds: [external.id] }],
    ])
      expect(
        complete(reserved, all, nowReal, { availableActions: actions }).state.impulses,
      ).toHaveLength(0);
    expect(
      complete(reserved, all, nowReal, {
        proposal: {
          ...proposal,
          impulses: [{ affordanceId: 'invent-tool', reason: 'Imagined capability' }],
        },
      }).state.impulses,
    ).toHaveLength(0);
    expect(
      complete(reserved, all, nowReal, { proposal: { ...proposal, impulses: [] } }).reason,
    ).toBe('committed');
  });

  it('deduplicates impulses and expires them within one real waking period', () => {
    const result = complete(begin().state, sources, nowReal, {
      availableActions: [{ ...action, expiresAtReal: nowReal + 10 * DREAM_INTERVAL_MS }],
      proposal: { ...proposal, impulses: [proposal.impulses[0], proposal.impulses[0]] },
    });
    expect(result.state.impulses).toHaveLength(1);
    expect(wakingDreamImpulses(result.state, nowReal)).toHaveLength(1);
    expect(wakingDreamImpulses(result.state, nowReal + DREAM_INTERVAL_MS)).toHaveLength(0);
    expect(wakingDreamImpulses(result.state, nowReal - 1)).toHaveLength(0);
  });

  it('supports a finite defer or deliberate dismissal without forcing execution or renewing expiry', () => {
    const state = complete(begin().state).state;
    const impulse = state.impulses[0];
    const deferred = updateWakeImpulse(state, impulse.id, {
      status: 'deferred',
      nowReal,
      untilReal: nowReal + 10_000,
    });
    expect(wakingDreamImpulses(deferred, nowReal + 9_999)).toHaveLength(0);
    expect(wakingDreamImpulses(deferred, nowReal + 10_000)).toHaveLength(1);
    expect(deferred.impulses[0].expiresAtReal).toBe(impulse.expiresAtReal);
    const dismissed = updateWakeImpulse(deferred, impulse.id, {
      status: 'dismissed',
      nowReal: nowReal + 10_000,
    });
    expect(wakingDreamImpulses(dismissed, nowReal + 10_000)).toHaveLength(0);
    expect(
      updateWakeImpulse(state, impulse.id, {
        status: 'deferred',
        nowReal,
        untilReal: nowReal + DREAM_INTERVAL_MS,
      }).impulses[0].deferredUntilReal,
    ).toBe(impulse.expiresAtReal);
    expect(state.impulses[0].status).toBe('pending');
  });

  it('cascades source removal/revision to private dreams, indexes and impulses while retaining the anti-farming fence', () => {
    const state = complete(begin().state, sources, nowReal, {
      interpretations: [
        {
          memoryId: 'episode-1',
          sourceIds: ['episode-1', 'episode-2'],
          text: 'A tentative interpretation.',
          retrievalOffset: 0.1,
        },
      ],
    }).state;
    for (const remaining of [
      [],
      sources.slice(1),
      [episode(1, { summary: 'edited without revision bump' }), ...sources.slice(1)],
    ]) {
      const pruned = pruneDreamState(state, remaining);
      expect(pruned.dreams).toHaveLength(0);
      expect(pruned.annotations).toHaveLength(0);
      expect(pruned.impulses).toHaveLength(0);
      expect(pruned.receipts).toHaveLength(0);
      expect(pruned.ledger).toEqual(state.ledger);
      expect(dreamRankingOffsets(state, remaining)).toEqual({});
    }
    expect(pruneDreamState(begin().state, []).pending).toBeNull();
    expect(begin(pruneDreamState(state, [])).reason).toBe('real-cooldown');
  });

  it('bounds retained dream records without trimming the evidence anti-replay ledger', () => {
    let state = createDreamState('hubert');
    for (let day = 0; day < 27; day++) {
      const daily = [episode(day * 3 + 10), episode(day * 3 + 11), episode(day * 3 + 12)];
      const reserved = begin(state, daily, nowReal + day * DREAM_INTERVAL_MS, laterRest(day));
      expect(reserved.reason).toBe('ready');
      state = complete(reserved.state, daily, nowReal + day * DREAM_INTERVAL_MS, {
        availableActions: [],
      }).state;
    }
    expect(state.dreams).toHaveLength(24);
    expect(state.receipts).toHaveLength(24);
    expect(state.ledger.consumedSourceEventIds).toHaveLength(81);
  });
});
