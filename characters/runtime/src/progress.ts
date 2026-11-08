/**
 * Deterministic waking attention, not a productivity score. All references, opportunities and
 * receipts come from the host. Plans, labels, explanations and model-written success claims are
 * deliberately absent from this API. It never changes needs, grants a tool or chooses an action.
 */
export const PROGRESS_LIMITS = {
  windowMs: 24 * 60 * 60 * 1000,
  intentions: 8,
  decisions: 32,
  outcomes: 32,
  evidence: 32,
  opportunities: 3,
  globalOpportunities: 5,
  evidenceGrace: 2,
  alternatives: 2,
} as const;

export interface ProgressIntentionRef {
  /** A canonical host project/intention ID. Renaming or paraphrasing does not create an ID. */
  key: string;
  /** A canonical world/object/resource ID, independent of its display name. */
  targetKey?: string;
}
export interface ProgressStep {
  /** A host-discovered permitted action. This hint still needs execution-time policy checks. */
  type: string;
  targetKey?: string;
}
export interface ProgressOpportunity {
  status: 'available' | 'blocked' | 'waiting';
  smallestStep?: ProgressStep;
  retryAt?: number;
  retryCondition?: string;
}
export interface ProgressEvidence {
  /** A relevant authoritative observation/source ID; recalling or rewording it is not new evidence. */
  id: string;
  revision?: string | number;
}
export type ProgressDecisionKind =
  | 'deliberate'
  | 'attempt'
  | 'rest'
  | 'watch'
  | 'play'
  | 'wait'
  | 'defer'
  | 'abandon';
export interface ProgressDecision {
  id: string;
  /** Host clock. A backwards clock cannot erase the current monitoring window. */
  at: number;
  intention?: ProgressIntentionRef;
  kind: ProgressDecisionKind;
  opportunity?: ProgressOpportunity;
  evidence?: readonly ProgressEvidence[];
  /** Host-accepted reason for deliberately deferring/abandoning, rather than opening another plan. */
  reason?: string;
}
export interface ProgressOutcome {
  id: string;
  at: number;
  decisionId: string;
  intentionKey: string;
  status: 'succeeded' | 'failed' | 'blocked' | 'uncertain';
  /** True only for evidence of a relevant permitted attempt, never for a completed reflection. */
  evidence: boolean;
}
export interface IntentionProgress extends ProgressIntentionRef {
  lastAt: number;
  deliberations: number;
  unconfirmedAttempts: number;
  failedAttempts: number;
  evidenceGrace: number;
  disposition: 'unresolved' | 'deferred' | 'abandoned';
  approach?: ProgressStep;
  reason?: string;
}
export interface ProgressLedger {
  version: 1;
  windowStartedAt: number;
  lastAt: number;
  intentions: IntentionProgress[];
  /** Includes evicted intentions so opening many projects cannot erase the shared signal. */
  unresolvedOpportunities: number;
  decisions: Array<{
    id: string;
    at: number;
    kind: ProgressDecisionKind;
    intentionKey?: string;
    settled?: boolean;
  }>;
  outcomes: ProgressOutcome[];
  evidence: Array<ProgressEvidence & { intentionKey: string }>;
}
export interface ProgressGuidance {
  kind: 'shrink' | 'defer' | 'select-alternative';
  intentionKey: string;
  targetKey?: string;
  reason:
    | 'repeated-deliberation'
    | 'repeated-unconfirmed-attempts'
    | 'repeated-failure'
    | 'project-hopping'
    | 'blocked';
  count: number;
  smallestStep?: ProgressStep;
  alternativesLimit: number;
  retryAt?: number;
  retryCondition?: string;
}

function validTime(at: number): number {
  if (!Number.isFinite(at) || at < 0)
    throw new Error('A finite non-negative host time is required.');
  return at;
}
function validKey(key: string): string {
  if (typeof key !== 'string' || !key.trim() || key.length > 160)
    throw new Error('A bounded stable host reference is required.');
  return key;
}
function validEvidence(evidence: ProgressEvidence): void {
  validKey(evidence.id);
  if (
    evidence.revision !== undefined &&
    !(
      (typeof evidence.revision === 'string' && evidence.revision.length <= 160) ||
      (typeof evidence.revision === 'number' && Number.isFinite(evidence.revision))
    )
  )
    throw new Error('A bounded evidence revision is required.');
}
function validateDecision(decision: ProgressDecision): void {
  validKey(decision.id);
  validTime(decision.at);
  if (decision.intention) {
    validKey(decision.intention.key);
    if (decision.intention.targetKey) validKey(decision.intention.targetKey);
  }
  if (decision.opportunity?.smallestStep) {
    validKey(decision.opportunity.smallestStep.type);
    if (decision.opportunity.smallestStep.targetKey)
      validKey(decision.opportunity.smallestStep.targetKey);
  }
  if (decision.opportunity?.retryAt !== undefined) validTime(decision.opportunity.retryAt);
  if ((decision.evidence?.length ?? 0) > PROGRESS_LIMITS.evidence)
    throw new Error('Too many progress evidence references.');
  for (const evidence of decision.evidence ?? []) validEvidence(evidence);
}

export function createProgressLedger(now = 0): ProgressLedger {
  validTime(now);
  return {
    version: 1,
    windowStartedAt: now,
    lastAt: now,
    intentions: [],
    unresolvedOpportunities: 0,
    decisions: [],
    outcomes: [],
    evidence: [],
  };
}

function prepare(input: ProgressLedger, at: number): ProgressLedger {
  const now = Math.max(input.lastAt, validTime(at));
  if (now - input.windowStartedAt >= PROGRESS_LIMITS.windowMs) {
    const fresh = createProgressLedger(now);
    // Keep bounded recent idempotency receipts across a window boundary.
    fresh.decisions = structuredClone(input.decisions);
    fresh.outcomes = structuredClone(input.outcomes);
    return fresh;
  }
  const ledger = structuredClone(input);
  ledger.lastAt = now;
  return ledger;
}
const pending = (intention: IntentionProgress) =>
  intention.deliberations + intention.unconfirmedAttempts;

function clearPending(ledger: ProgressLedger, intention: IntentionProgress): void {
  ledger.unresolvedOpportunities = Math.max(0, ledger.unresolvedOpportunities - pending(intention));
  intention.deliberations = 0;
  intention.unconfirmedAttempts = 0;
  intention.evidenceGrace = 0;
}

/** Quiet activities suspend this check. They do not need a reason, an artifact, or an intention. */
export function recordProgressDecision(
  input: ProgressLedger,
  decision: ProgressDecision,
): { ledger: ProgressLedger; guidance: ProgressGuidance | null } {
  validateDecision(decision);
  const ledger = prepare(input, decision.at);
  if (ledger.decisions.some((entry) => entry.id === decision.id)) return { ledger, guidance: null };
  ledger.decisions.push({
    id: decision.id,
    at: ledger.lastAt,
    kind: decision.kind,
    ...(decision.intention ? { intentionKey: decision.intention.key } : {}),
  });
  ledger.decisions = ledger.decisions.slice(-PROGRESS_LIMITS.decisions);
  if (['rest', 'watch', 'play', 'wait'].includes(decision.kind) || !decision.intention)
    return { ledger, guidance: null };

  let intention = ledger.intentions.find((item) => item.key === decision.intention!.key);
  if (!intention) {
    intention = {
      ...decision.intention,
      lastAt: ledger.lastAt,
      deliberations: 0,
      unconfirmedAttempts: 0,
      failedAttempts: 0,
      evidenceGrace: 0,
      disposition: 'unresolved',
    };
    ledger.intentions.push(intention);
    ledger.intentions = ledger.intentions.slice(-PROGRESS_LIMITS.intentions);
  }
  intention.lastAt = ledger.lastAt;
  // The host reference wins over display-name changes. Target changes never clear its counters.
  if (decision.intention.targetKey) intention.targetKey = decision.intention.targetKey;

  if (decision.kind === 'defer' || decision.kind === 'abandon') {
    if (!decision.reason?.trim()) return { ledger, guidance: null };
    clearPending(ledger, intention);
    intention.failedAttempts = 0;
    intention.disposition = decision.kind === 'defer' ? 'deferred' : 'abandoned';
    intention.reason = decision.reason.trim().slice(0, 320);
    return { ledger, guidance: null };
  }
  intention.disposition = 'unresolved';
  delete intention.reason;
  let newEvidence = false;
  for (const evidence of decision.evidence ?? []) {
    if (
      ledger.evidence.some(
        (entry) =>
          entry.intentionKey === intention.key &&
          entry.id === evidence.id &&
          entry.revision === evidence.revision,
      )
    )
      continue;
    ledger.evidence.push({ ...evidence, intentionKey: intention.key });
    ledger.evidence = ledger.evidence.slice(-PROGRESS_LIMITS.evidence);
    newEvidence = true;
    // New observations permit some reconsideration, but cannot buy endless fresh plans.
    intention.evidenceGrace = Math.min(PROGRESS_LIMITS.evidenceGrace, intention.evidenceGrace + 1);
  }

  const opportunity = decision.opportunity;
  if (!opportunity || opportunity.status === 'waiting') return { ledger, guidance: null };
  if (opportunity.status === 'available' && opportunity.smallestStep) {
    const changedApproach =
      intention.approach &&
      (intention.approach.type !== opportunity.smallestStep.type ||
        intention.approach.targetKey !== opportunity.smallestStep.targetKey);
    // An evidence-backed alternative is a new experiment, not three failures of that experiment.
    // It never erases the no-attempt counter merely because the target or plan was changed.
    if (changedApproach && newEvidence) intention.failedAttempts = 0;
    intention.approach = { ...opportunity.smallestStep };
  }
  const guidance = (
    kind: ProgressGuidance['kind'],
    reason: ProgressGuidance['reason'],
    count: number,
  ): ProgressGuidance => ({
    kind,
    intentionKey: intention.key,
    ...(intention.targetKey ? { targetKey: intention.targetKey } : {}),
    reason,
    count,
    alternativesLimit: PROGRESS_LIMITS.alternatives,
    ...(opportunity.status === 'available' && opportunity.smallestStep
      ? { smallestStep: { ...opportunity.smallestStep } }
      : {}),
    ...(opportunity.retryAt !== undefined ? { retryAt: opportunity.retryAt } : {}),
    ...(opportunity.retryCondition
      ? { retryCondition: opportunity.retryCondition.slice(0, 320) }
      : {}),
  });
  if (opportunity.status === 'blocked')
    return { ledger, guidance: guidance('defer', 'blocked', pending(intention)) };

  if (decision.kind === 'deliberate') intention.deliberations += 1;
  else if (decision.kind === 'attempt') intention.unconfirmedAttempts += 1;
  ledger.unresolvedOpportunities += 1;
  if (intention.failedAttempts >= PROGRESS_LIMITS.opportunities)
    return {
      ledger,
      guidance: guidance('select-alternative', 'repeated-failure', intention.failedAttempts),
    };
  const localCount = pending(intention);
  const localStall = localCount >= PROGRESS_LIMITS.opportunities + intention.evidenceGrace;
  const globalStall =
    ledger.unresolvedOpportunities >= PROGRESS_LIMITS.globalOpportunities + intention.evidenceGrace;
  if (!localStall && !globalStall) return { ledger, guidance: null };
  const reason = localStall
    ? intention.unconfirmedAttempts > intention.deliberations
      ? 'repeated-unconfirmed-attempts'
      : 'repeated-deliberation'
    : 'project-hopping';
  return {
    ledger,
    guidance: guidance(
      opportunity.smallestStep ? 'shrink' : 'select-alternative',
      reason,
      localStall ? localCount : ledger.unresolvedOpportunities,
    ),
  };
}

/** Only matching authoritative receipts can turn a proposed experiment into an actual attempt. */
export function recordProgressOutcome(
  input: ProgressLedger,
  outcome: ProgressOutcome,
): ProgressLedger {
  validKey(outcome.id);
  validKey(outcome.decisionId);
  validKey(outcome.intentionKey);
  validTime(outcome.at);
  const ledger = prepare(input, outcome.at);
  if (ledger.outcomes.some((entry) => entry.id === outcome.id)) return ledger;
  const decision = ledger.decisions.find(
    (entry) =>
      entry.id === outcome.decisionId &&
      entry.intentionKey === outcome.intentionKey &&
      entry.kind === 'attempt',
  );
  if (!decision || decision.settled) return ledger;
  // An uncertain receipt can later be reconciled; an already verified attempt cannot count twice.
  if (
    ledger.outcomes.some(
      (entry) =>
        entry.decisionId === outcome.decisionId &&
        (entry.status === 'blocked' ||
          (entry.evidence && ['succeeded', 'failed'].includes(entry.status))),
    )
  )
    return ledger;
  ledger.outcomes.push({ ...outcome });
  ledger.outcomes = ledger.outcomes.slice(-PROGRESS_LIMITS.outcomes);
  if (
    outcome.status === 'blocked' ||
    (outcome.evidence && ['succeeded', 'failed'].includes(outcome.status))
  )
    decision.settled = true;
  const intention = ledger.intentions.find((entry) => entry.key === outcome.intentionKey);
  if (!intention || !outcome.evidence || !['succeeded', 'failed'].includes(outcome.status))
    return ledger;
  // Both a successful step and an informative failed experiment interrupt rumination.
  clearPending(ledger, intention);
  intention.failedAttempts = outcome.status === 'failed' ? intention.failedAttempts + 1 : 0;
  return ledger;
}
