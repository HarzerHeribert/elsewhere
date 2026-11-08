import { describe, expect, it } from 'vitest';
import {
  createProgressLedger,
  recordProgressDecision,
  recordProgressOutcome,
  PROGRESS_LIMITS,
  type ProgressDecision,
  type ProgressLedger,
} from './progress';

const intention = { key: 'project:weather-study', targetKey: 'object:workbench' };
const opportunity = {
  status: 'available' as const,
  smallestStep: { type: 'work', targetKey: 'object:workbench' },
};
function decide(ledger: ProgressLedger, id: number, overrides: Partial<ProgressDecision> = {}) {
  return recordProgressDecision(ledger, {
    id: `decision:${id}`,
    at: id * 1000,
    kind: 'deliberate',
    intention,
    opportunity,
    ...overrides,
  });
}
function finish(ledger: ProgressLedger, id: number, status: 'succeeded' | 'failed' = 'succeeded') {
  return recordProgressOutcome(ledger, {
    id: `receipt:${id}`,
    at: id * 1000,
    decisionId: `decision:${id}`,
    intentionKey: intention.key,
    status,
    evidence: true,
  });
}

describe('waking progress attention', () => {
  it('offers a small permitted step after repeated plans on a stable host intention', () => {
    let ledger = createProgressLedger();
    for (let id = 1; id < 3; id += 1) {
      const result = decide(ledger, id);
      expect(result.guidance).toBeNull();
      ledger = result.ledger;
    }
    const before = structuredClone(ledger);
    const result = decide(ledger, 3);
    expect(result.guidance).toMatchObject({
      kind: 'shrink',
      intentionKey: intention.key,
      reason: 'repeated-deliberation',
      count: 3,
      smallestStep: opportunity.smallestStep,
      alternativesLimit: 2,
    });
    expect(ledger).toEqual(before);
    // Labels and plan prose are not accepted as progress inputs; changing a target cannot reset it.
    expect(
      decide(result.ledger, 4, {
        intention: { key: intention.key, targetKey: 'object:renamed-or-alternative-bench' },
      }).guidance,
    ).toMatchObject({ reason: 'repeated-deliberation', count: 4 });
  });

  it('keeps a shared signal through project hopping and bounded intention eviction', () => {
    let ledger = createProgressLedger();
    for (let id = 1; id <= 12; id += 1) {
      const result = decide(ledger, id, { intention: { key: `project:${id}` } });
      ledger = result.ledger;
      if (id >= 5)
        expect(result.guidance).toMatchObject({
          reason: 'project-hopping',
          count: id,
        });
    }
    expect(ledger.intentions).toHaveLength(PROGRESS_LIMITS.intentions);
    expect(ledger.unresolvedOpportunities).toBe(12);
    expect(decide(ledger, 13, { intention: { key: 'project:1' } }).guidance).not.toBeNull();
  });

  it('allows bounded evidence-based reconsideration without resetting deliberation', () => {
    let ledger = decide(createProgressLedger(), 1).ledger;
    ledger = decide(ledger, 2).ledger;
    const evidence = [{ id: 'world:bird', revision: 2 }];
    const reconsidered = decide(ledger, 3, { evidence });
    expect(reconsidered.guidance).toBeNull();
    expect(reconsidered.ledger.intentions[0]).toMatchObject({
      deliberations: 3,
      evidenceGrace: 1,
    });
    expect(decide(reconsidered.ledger, 4, { evidence }).guidance).not.toBeNull();
    ledger = createProgressLedger();
    for (let id = 1; id <= 6; id += 1) {
      const result = decide(ledger, id, { evidence: [{ id: `real-observation:${id}` }] });
      ledger = result.ledger;
      if (id >= 5) expect(result.guidance).not.toBeNull();
    }
    expect(ledger.intentions[0].evidenceGrace).toBe(2);
  });

  it('requires an actual matching attempt receipt rather than a proposed or narrated success', () => {
    let ledger = decide(createProgressLedger(), 1).ledger;
    ledger = decide(ledger, 2).ledger;
    const attempted = decide(ledger, 3, { kind: 'attempt' });
    expect(attempted.guidance).not.toBeNull();
    ledger = attempted.ledger;
    const receipt = {
      id: 'receipt:unverified',
      at: 3000,
      decisionId: 'decision:3',
      intentionKey: intention.key,
      status: 'succeeded' as const,
      evidence: false,
    };
    ledger = recordProgressOutcome(ledger, receipt);
    expect(ledger.unresolvedOpportunities).toBe(3);
    ledger = recordProgressOutcome(ledger, {
      ...receipt,
      id: 'receipt:wrong-intent',
      intentionKey: 'project:unrelated',
      evidence: true,
    });
    ledger = recordProgressOutcome(ledger, {
      ...receipt,
      id: 'receipt:reflection',
      decisionId: 'decision:2',
      evidence: true,
    });
    expect(ledger.unresolvedOpportunities).toBe(3);
    ledger = finish(ledger, 3);
    expect(ledger.unresolvedOpportunities).toBe(0);
    expect(decide(ledger, 4).guidance).toBeNull();
  });

  it('does not let verified progress on a different project erase an unresolved intention', () => {
    let ledger = decide(createProgressLedger(), 1).ledger;
    ledger = decide(ledger, 2).ledger;
    ledger = decide(ledger, 3, {
      kind: 'attempt',
      intention: { key: 'project:other' },
    }).ledger;
    ledger = recordProgressOutcome(ledger, {
      id: 'receipt:other',
      at: 3000,
      decisionId: 'decision:3',
      intentionKey: 'project:other',
      status: 'succeeded',
      evidence: true,
    });
    expect(ledger.unresolvedOpportunities).toBe(2);
    expect(decide(ledger, 4).guidance).toMatchObject({ reason: 'repeated-deliberation' });
  });

  it('preserves other unresolved projects when a long-running intention finally gets an attempt', () => {
    let ledger = createProgressLedger();
    for (let id = 1; id <= 1001; id += 1) ledger = decide(ledger, id).ledger;
    for (let id = 1002; id <= 1006; id += 1)
      ledger = decide(ledger, id, { intention: { key: `project:${id}` } }).ledger;
    ledger = decide(ledger, 1007, { kind: 'attempt' }).ledger;
    ledger = finish(ledger, 1007);
    expect(ledger.unresolvedOpportunities).toBe(5);
    expect(decide(ledger, 1008, { intention: { key: 'project:another' } }).guidance).toMatchObject({
      reason: 'project-hopping',
    });
  });

  it('detects repeated no-op or uncertain proposals without treating them as accomplishments', () => {
    let ledger = createProgressLedger();
    for (let id = 1; id <= 3; id += 1) {
      const result = decide(ledger, id, { kind: 'attempt' });
      ledger = recordProgressOutcome(result.ledger, {
        id: `receipt:${id}`,
        at: id * 1000,
        decisionId: `decision:${id}`,
        intentionKey: intention.key,
        status: id === 1 ? 'succeeded' : 'uncertain',
        evidence: false,
      });
      if (id === 3)
        expect(result.guidance).toMatchObject({ reason: 'repeated-unconfirmed-attempts' });
    }
    expect(ledger.intentions[0].unconfirmedAttempts).toBe(3);
    // A later authoritative reconciliation is allowed exactly once.
    ledger = recordProgressOutcome(ledger, {
      id: 'receipt:reconciled',
      at: 4000,
      decisionId: 'decision:3',
      intentionKey: intention.key,
      status: 'succeeded',
      evidence: true,
    });
    ledger = decide(ledger, 5).ledger;
    expect(finish(ledger, 3).unresolvedOpportunities).toBe(1);
  });

  it('recognizes informative experiments and offers alternatives for repeated failed approaches', () => {
    let ledger = createProgressLedger();
    for (let id = 1; id <= 3; id += 1) {
      ledger = decide(ledger, id, { kind: 'attempt' }).ledger;
      ledger = finish(ledger, id, 'failed');
      expect(ledger.unresolvedOpportunities).toBe(0);
    }
    const repeated = decide(ledger, 4);
    expect(repeated.guidance).toMatchObject({
      kind: 'select-alternative',
      reason: 'repeated-failure',
    });
    const newExperiment = decide(repeated.ledger, 5, {
      evidence: [{ id: 'world:changed-condition' }],
      opportunity: {
        status: 'available',
        smallestStep: { type: 'inspect', targetKey: 'object:workbench' },
      },
    });
    expect(newExperiment.guidance).toBeNull();
    expect(newExperiment.ledger.intentions[0]).toMatchObject({
      failedAttempts: 0,
      deliberations: 2,
    });
  });

  it('never demands artifacts from peaceful rest, watch, play or legitimate waiting', () => {
    let ledger = decide(createProgressLedger(), 1).ledger;
    ledger = decide(ledger, 2).ledger;
    const tracked = structuredClone(ledger.intentions);
    for (let id = 3; id < 43; id += 1) {
      const kind = (['rest', 'watch', 'play', 'wait'] as const)[id % 4];
      const result = decide(ledger, id, { kind });
      ledger = result.ledger;
      expect(result.guidance).toBeNull();
    }
    expect(ledger.intentions).toEqual(tracked);
    expect(ledger.unresolvedOpportunities).toBe(2);
    expect(decide(ledger, 44).guidance).not.toBeNull();
    expect(
      decide(createProgressLedger(), 1, { kind: 'watch', intention: undefined }).guidance,
    ).toBeNull();
  });

  it('respects waiting and real blockers without manufacturing an executable step', () => {
    let ledger = createProgressLedger();
    for (let id = 1; id <= 8; id += 1) {
      const result = decide(ledger, id, {
        opportunity: { status: 'waiting', retryAt: 10_000, retryCondition: 'The path finishes.' },
      });
      ledger = result.ledger;
      expect(result.guidance).toBeNull();
    }
    expect(ledger.unresolvedOpportunities).toBe(0);
    const blocked = decide(ledger, 9, {
      opportunity: {
        status: 'blocked',
        smallestStep: { type: 'disabled-worker' },
        retryCondition: 'A scoped worker capability becomes available.',
      },
    });
    expect(blocked.guidance).toMatchObject({ kind: 'defer', reason: 'blocked' });
    expect(blocked.guidance?.smallestStep).toBeUndefined();
    expect(blocked.ledger.unresolvedOpportunities).toBe(0);
  });

  it('accepts a deliberate defer or abandonment and retains its bounded reason', () => {
    let ledger = decide(createProgressLedger(), 1).ledger;
    ledger = decide(ledger, 2).ledger;
    const unresolved = decide(ledger, 3, { kind: 'defer' });
    expect(unresolved.ledger.unresolvedOpportunities).toBe(2);
    const deferred = decide(unresolved.ledger, 4, {
      kind: 'defer',
      reason: 'I prefer to watch birds until the missing material is available.',
    });
    expect(deferred.guidance).toBeNull();
    expect(deferred.ledger.intentions[0]).toMatchObject({
      disposition: 'deferred',
      deliberations: 0,
    });
    expect(deferred.ledger.unresolvedOpportunities).toBe(0);
    const abandoned = decide(deferred.ledger, 5, {
      kind: 'abandon',
      reason: 'My interest changed.',
    });
    expect(abandoned.ledger.intentions[0].disposition).toBe('abandoned');
    expect(abandoned.ledger.intentions[0].reason).toBe('My interest changed.');
  });

  it('deduplicates decisions and receipts across serialization without losing the signal', () => {
    let ledger = decide(createProgressLedger(), 1).ledger;
    ledger = decide(ledger, 2).ledger;
    ledger = JSON.parse(JSON.stringify(ledger)) as ProgressLedger;
    expect(decide(ledger, 2).ledger).toEqual(ledger);
    ledger = decide(ledger, 3, { kind: 'attempt' }).ledger;
    ledger = finish(ledger, 3);
    ledger = decide(ledger, 4).ledger;
    expect(finish(ledger, 3).unresolvedOpportunities).toBe(1);
    expect(
      recordProgressOutcome(ledger, {
        id: 'receipt:same-attempt-renamed',
        at: 5000,
        decisionId: 'decision:3',
        intentionKey: intention.key,
        status: 'succeeded',
        evidence: true,
      }).unresolvedOpportunities,
    ).toBe(1);
  });

  it('bounds records and expires an old monitoring window without using a backwards clock', () => {
    let ledger = createProgressLedger();
    for (let id = 1; id <= 100; id += 1) {
      ledger = decide(ledger, id, {
        kind: 'attempt',
        evidence: [{ id: `world:${id}` }],
      }).ledger;
      ledger = finish(ledger, id);
    }
    expect(ledger.decisions).toHaveLength(PROGRESS_LIMITS.decisions);
    expect(ledger.outcomes).toHaveLength(PROGRESS_LIMITS.outcomes);
    expect(ledger.evidence).toHaveLength(PROGRESS_LIMITS.evidence);
    ledger = decide(ledger, 101).ledger;
    ledger = decide(ledger, 102).ledger;
    const backwards = decide(ledger, 103, { at: 0 });
    expect(backwards.guidance).not.toBeNull();
    expect(backwards.ledger.lastAt).toBe(102_000);
    const expired = decide(backwards.ledger, 104, { at: PROGRESS_LIMITS.windowMs + 1 });
    expect(expired.guidance).toBeNull();
    expect(expired.ledger.unresolvedOpportunities).toBe(1);
  });

  it('rejects invalid clocks and ambiguous or oversized host references', () => {
    expect(() => createProgressLedger(NaN)).toThrow(/host time/);
    expect(() => decide(createProgressLedger(), 1, { at: -1 })).toThrow(/host time/);
    expect(() => decide(createProgressLedger(), 1, { intention: { key: ' ' } })).toThrow(
      /host reference/,
    );
    expect(() =>
      decide(createProgressLedger(), 1, { intention: { key: 'x'.repeat(161) } }),
    ).toThrow(/host reference/);
    expect(() =>
      decide(createProgressLedger(), 1, { evidence: [{ id: 'source', revision: NaN }] }),
    ).toThrow(/evidence revision/);
    expect(() =>
      decide(createProgressLedger(), 1, {
        evidence: Array.from({ length: 33 }, (_, id) => ({ id: `source:${id}` })),
      }),
    ).toThrow(/Too many/);
  });
});
