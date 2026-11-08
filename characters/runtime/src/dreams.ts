import type { EpisodicMemory } from './index';

/** All timestamps ending in Real use a trusted wall clock, never the simulation clock. */
export const DREAM_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DREAM_MIN_REST_REAL_MS = 2 * 60 * 1000;
export const DREAM_MIN_REST_MS = 5 * 60 * 1000;
export const DREAM_MIN_NEW_EPISODES = 3;
export const DREAM_MAX_SOURCES = 12;
export const DREAM_MAX_RETRIEVAL_OFFSET = 0.25;
const MAX_HISTORY = 24;
const MAX_IMPULSE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Sources come from the host's existing authorized memory query, not a second memory store. */
export interface DreamSource extends EpisodicMemory {
  revision: string;
  /** A selection cue only. Repeated recall never counts as new evidence. */
  recalledCount?: number;
}

export interface DreamRestSession {
  id: string;
  voluntary: boolean;
  startedAt: number;
  endedAt: number;
  startedAtReal: number;
  endedAtReal: number;
}

export interface DreamSourceReference {
  id: string;
  revision: string;
  sourceEventId: string;
  contentFingerprint: string;
}

export interface DreamConsolidationRequest {
  idempotencyKey: string;
  characterId: string;
  restSessionId: string;
  reservedAtReal: number;
  sourceWindow: { from: number; to: number };
  sources: DreamSource[];
  newEvidenceIds: string[];
}

/** Model output has no numeric weights, permissions, target IDs or executable arguments. */
export interface DreamProposal {
  vignette: string;
  impulses: Array<{ affordanceId: string; reason: string }>;
}

/** The host supplies currently feasible actions; a proposal can only select one of these. */
export interface DreamAction {
  id: string;
  description: string;
  sourceIds: string[];
  targetId: string;
  action: string;
  expiresAtReal: number;
  retryCondition: string;
}

/** Trusted character policy, supplied separately from the untrusted reflection proposal. */
export interface DreamInterpretationUpdate {
  memoryId: string;
  sourceIds: string[];
  text: string;
  status?: 'active' | 'unresolved' | 'archived';
  /** Absolute offset from factual retrieval ranking, never an increment to the previous offset. */
  retrievalOffset: number;
}

export interface DreamRetrievalAnnotation {
  kind: 'interpretation';
  visibility: 'private';
  memoryId: string;
  sources: DreamSourceReference[];
  text: string;
  status: 'active' | 'unresolved' | 'archived';
  retrievalOffset: number;
  receiptId: string;
  updatedAtReal: number;
}

export interface DreamRecord {
  id: string;
  kind: 'imagined-dream';
  visibility: 'private';
  version: 1;
  receiptId: string;
  restSessionId: string;
  createdAtReal: number;
  sources: DreamSourceReference[];
  vignette: string;
}

export interface WakeImpulse {
  id: string;
  visibility: 'private';
  version: 1;
  receiptId: string;
  sourceIds: string[];
  sources: DreamSourceReference[];
  affordanceId: string;
  targetId: string;
  action: string;
  reason: string;
  retryCondition: string;
  createdAtReal: number;
  expiresAtReal: number;
  deferredUntilReal: number | null;
  status: 'pending' | 'completed' | 'dismissed';
}

export interface DreamConsolidationReceipt {
  id: string;
  version: 1;
  visibility: 'private';
  idempotencyKey: string;
  characterId: string;
  restSessionId: string;
  sourceWindow: { from: number; to: number };
  sources: DreamSourceReference[];
  completedAtReal: number;
  dreamId: string;
  impulseIds: string[];
}

/** Persist this entire value atomically. Keep ledger on reset, even when memories are cleared. */
export interface DreamState {
  version: 1;
  characterId: string;
  ledger: {
    lastAttemptAtReal: number | null;
    lastConsolidatedAtReal: number | null;
    lastRestSessionId: string | null;
    lastRestEndedAtReal: number | null;
    /** Durable opaque event IDs only; never episode text. Do not trim this anti-replay ledger. */
    consumedSourceEventIds: string[];
  };
  pending: DreamConsolidationRequest | null;
  annotations: DreamRetrievalAnnotation[];
  dreams: DreamRecord[];
  impulses: WakeImpulse[];
  receipts: DreamConsolidationReceipt[];
}

export type DreamBeginReason =
  | 'ready'
  | 'pending'
  | 'real-cooldown'
  | 'rest-not-qualified'
  | 'rest-already-used'
  | 'insufficient-new-evidence'
  | 'invalid-sources';

const finiteTime = (value: number) => Number.isFinite(value) && value >= 0;
const identifier = (value: string) =>
  typeof value === 'string' && !!value.trim() && value.length <= 240;
const copySource = (source: DreamSource): DreamSource => ({
  ...source,
  cues: source.cues.map((cue) => ({ ...cue })),
  emotionalContext: { ...source.emotionalContext },
  ...(source.experience ? { experience: { ...source.experience } } : {}),
});
const reference = (source: DreamSource): DreamSourceReference => ({
  id: source.id,
  revision: source.revision,
  sourceEventId: source.sourceEventId,
  contentFingerprint: compactDigest(fingerprint(source)),
});

/** Compact portable identity, never an authorization/signature check. Exact content is checked at commit. */
function compactDigest(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

/** An exact source fingerprint also detects content changed without a host revision bump. */
function fingerprint(source: EpisodicMemory): string {
  return JSON.stringify([
    source.id,
    source.createdAt,
    source.sourceEventId,
    source.source,
    source.verified,
    source.summary,
    source.cues.map((cue) => [cue.kind, cue.value]),
    source.emotionalContext.mood,
    source.emotionalContext.frustration,
    source.salience,
    source.experience
      ? [source.experience.action, source.experience.targetId ?? null, source.experience.status]
      : null,
  ]);
}

export function toDreamSource(
  memory: EpisodicMemory,
  revision = `episode:v1:${compactDigest(fingerprint(memory))}`,
  recalledCount = 0,
): DreamSource {
  return copySource({ ...memory, revision, recalledCount });
}

export function createDreamState(characterId: string): DreamState {
  if (!identifier(characterId)) throw new Error('A stable character ID is required for dreaming.');
  return {
    version: 1,
    characterId,
    ledger: {
      lastAttemptAtReal: null,
      lastConsolidatedAtReal: null,
      lastRestSessionId: null,
      lastRestEndedAtReal: null,
      consumedSourceEventIds: [],
    },
    pending: null,
    annotations: [],
    dreams: [],
    impulses: [],
    receipts: [],
  };
}

function validSource(source: DreamSource): boolean {
  return (
    identifier(source.id) &&
    identifier(source.sourceEventId) &&
    typeof source.revision === 'string' &&
    source.revision.length > 0 &&
    source.revision.length <= 240 &&
    finiteTime(source.createdAt) &&
    typeof source.summary === 'string' &&
    source.summary.length <= 4_000 &&
    (source.source === 'world-outcome' || source.source === 'external-message') &&
    typeof source.verified === 'boolean' &&
    Array.isArray(source.cues) &&
    source.cues.length <= 32 &&
    source.cues.every(
      (cue) =>
        ['place', 'object', 'entity', 'person', 'phrase'].includes(cue.kind) &&
        typeof cue.value === 'string' &&
        cue.value.length <= 240,
    ) &&
    Number.isFinite(source.emotionalContext?.mood) &&
    Number.isFinite(source.emotionalContext?.frustration) &&
    Number.isFinite(source.salience) &&
    (source.experience === undefined ||
      (identifier(source.experience.action) &&
        (source.experience.targetId === undefined || identifier(source.experience.targetId)) &&
        ['completed', 'rejected'].includes(source.experience.status)))
  );
}

const livedEvidence = (source: DreamSource) => source.verified && source.source === 'world-outcome';

/** Reserve once BEFORE inference and durably save the returned state before dispatching a call. */
export function beginDreamConsolidation(input: {
  state: DreamState;
  sources: readonly DreamSource[];
  rest: DreamRestSession;
  nowReal: number;
}): { state: DreamState; request: DreamConsolidationRequest | null; reason: DreamBeginReason } {
  const { state, sources, rest, nowReal } = input;
  const reject = (reason: DreamBeginReason) => ({ state, request: null, reason });
  if (state.pending) return reject('pending');
  if (
    !finiteTime(nowReal) ||
    (state.ledger.lastAttemptAtReal !== null &&
      nowReal - state.ledger.lastAttemptAtReal < DREAM_INTERVAL_MS)
  )
    return reject('real-cooldown');
  if (
    !identifier(rest.id) ||
    !rest.voluntary ||
    ![rest.startedAt, rest.endedAt, rest.startedAtReal, rest.endedAtReal].every(finiteTime) ||
    rest.endedAt > Number.MAX_SAFE_INTEGER ||
    rest.endedAtReal > nowReal ||
    rest.endedAt - rest.startedAt < DREAM_MIN_REST_MS ||
    rest.endedAtReal - rest.startedAtReal < DREAM_MIN_REST_REAL_MS
  )
    return reject('rest-not-qualified');
  if (
    state.ledger.lastRestSessionId === rest.id ||
    (state.ledger.lastRestEndedAtReal !== null &&
      rest.startedAtReal < state.ledger.lastRestEndedAtReal)
  )
    return reject('rest-already-used');
  const ids = new Set<string>();
  if (
    sources.some((source) => {
      if (!validSource(source) || ids.has(source.id)) return true;
      ids.add(source.id);
      return false;
    })
  )
    return reject('invalid-sources');
  const consumed = new Set(state.ledger.consumedSourceEventIds);
  const eligibleSources = sources.filter((source) => source.createdAt <= rest.endedAt);
  const fresh = eligibleSources.filter(
    (source) => livedEvidence(source) && !consumed.has(source.sourceEventId),
  );
  // Multiple summaries, revisions, or paraphrases of one real event are one piece of evidence.
  if (new Set(fresh.map((source) => source.sourceEventId)).size < DREAM_MIN_NEW_EPISODES)
    return reject('insufficient-new-evidence');
  const byRecency = (a: DreamSource, b: DreamSource) =>
    b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  const selected: DreamSource[] = [];
  const selectedIds = new Set<string>();
  const selectedEvents = new Set<string>();
  const add = (source: DreamSource) => {
    if (selectedIds.has(source.id) || selected.length >= DREAM_MAX_SOURCES) return;
    selected.push(copySource(source));
    selectedIds.add(source.id);
  };
  // Guarantee genuinely new distinct events before spending slots on older associative material.
  for (const source of [...fresh].sort(byRecency)) {
    if (!selectedEvents.has(source.sourceEventId)) {
      add(source);
      selectedEvents.add(source.sourceEventId);
    }
    if (selected.length >= 8) break;
  }
  const older = eligibleSources.filter(
    (source) => (source.recalledCount ?? 0) > 1 && !selectedIds.has(source.id),
  );
  older
    .sort((a, b) => (b.recalledCount ?? 0) - (a.recalledCount ?? 0) || byRecency(a, b))
    .slice(0, 2)
    .forEach(add);
  // Salience/taste is a modest deterministic cue; recalled count never strengthens a belief.
  [...eligibleSources].sort((a, b) => b.salience - a.salience || byRecency(a, b)).forEach(add);
  selected.sort(byRecency);
  const newEvidenceIds = selected
    .filter((source) => livedEvidence(source) && !consumed.has(source.sourceEventId))
    .map((source) => source.id);
  const sourceWindow = {
    from: Math.min(...selected.map((source) => source.createdAt)),
    to: Math.max(...selected.map((source) => source.createdAt)),
  };
  const keyContent = JSON.stringify([
    state.characterId,
    rest.id,
    sourceWindow.from,
    sourceWindow.to,
    selected.map(reference).sort((a, b) => a.id.localeCompare(b.id)),
  ]);
  const idempotencyKey = `dream:v1:${compactDigest(keyContent)}`;
  const request: DreamConsolidationRequest = {
    idempotencyKey,
    characterId: state.characterId,
    restSessionId: rest.id,
    reservedAtReal: nowReal,
    sourceWindow,
    sources: selected,
    newEvidenceIds,
  };
  return {
    state: {
      ...state,
      pending: structuredClone(request),
      ledger: {
        ...state.ledger,
        lastAttemptAtReal: nowReal,
        lastRestSessionId: rest.id,
        lastRestEndedAtReal: rest.endedAtReal,
        // Advance over the entire observed window, including unselected backlog. Otherwise a
        // large old backlog could fund later sessions without any intervening lived activity.
        // Failures consume the window too; old evidence must not buy another call.
        consumedSourceEventIds: [
          ...new Set([
            ...state.ledger.consumedSourceEventIds,
            ...eligibleSources.filter(livedEvidence).map((source) => source.sourceEventId),
          ]),
        ],
      },
    },
    request: structuredClone(request),
    reason: 'ready',
  };
}

export type DreamCompleteReason =
  | 'committed'
  | 'duplicate'
  | 'no-reservation'
  | 'stale-sources'
  | 'invalid-proposal';

function shortText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && !!value.trim();
}

/** Returns a complete next-state value for one atomic host commit; it performs no I/O or actions. */
export function completeDreamConsolidation(input: {
  state: DreamState;
  requestKey: string;
  currentSources: readonly DreamSource[];
  proposal: DreamProposal;
  nowReal: number;
  availableActions: readonly DreamAction[];
  interpretations?: readonly DreamInterpretationUpdate[];
}): { state: DreamState; receipt: DreamConsolidationReceipt | null; reason: DreamCompleteReason } {
  const { state, requestKey, currentSources, proposal, nowReal, availableActions } = input;
  const prior = state.receipts.find((receipt) => receipt.idempotencyKey === requestKey);
  if (prior) return { state, receipt: prior, reason: 'duplicate' };
  const request = state.pending;
  if (
    !request ||
    request.idempotencyKey !== requestKey ||
    request.characterId !== state.characterId
  )
    return { state, receipt: null, reason: 'no-reservation' };
  const fail = (reason: DreamCompleteReason) => ({
    state: { ...state, pending: null },
    receipt: null,
    reason,
  });
  const current = new Map(currentSources.map((source) => [source.id, source]));
  if (
    current.size !== currentSources.length ||
    request.sources.some((source) => {
      const latest = current.get(source.id);
      return (
        !latest ||
        !validSource(latest) ||
        latest.revision !== source.revision ||
        fingerprint(latest) !== fingerprint(source)
      );
    })
  )
    return fail('stale-sources');
  if (
    !finiteTime(nowReal) ||
    nowReal < request.reservedAtReal ||
    !proposal ||
    !shortText(proposal.vignette, 2_000) ||
    !Array.isArray(proposal.impulses) ||
    proposal.impulses.length > 2 ||
    proposal.impulses.some(
      (impulse) =>
        !impulse ||
        typeof impulse !== 'object' ||
        !identifier(impulse.affordanceId) ||
        !shortText(impulse.reason, 320),
    ) ||
    Object.keys(proposal).some((key) => !['vignette', 'impulses'].includes(key)) ||
    proposal.impulses.some((impulse) =>
      Object.keys(impulse).some((key) => !['affordanceId', 'reason'].includes(key)),
    )
  )
    return fail('invalid-proposal');
  const sources = new Map(request.sources.map((source) => [source.id, source]));
  const refs = request.sources.map(reference);
  const receiptId = `${requestKey}:receipt`;
  const dreamId = `${requestKey}:dream`;
  const actionIds = new Set<string>();
  const actions = new Map<string, DreamAction>();
  for (const action of availableActions) {
    // Ambiguous duplicate host IDs are not a usable capability.
    if (actionIds.has(action.id)) {
      actions.delete(action.id);
      continue;
    }
    actionIds.add(action.id);
    if (
      !identifier(action.id) ||
      !identifier(action.targetId) ||
      !identifier(action.action) ||
      !shortText(action.description, 500) ||
      !shortText(action.retryCondition, 320) ||
      !finiteTime(action.expiresAtReal) ||
      action.expiresAtReal <= nowReal ||
      !Array.isArray(action.sourceIds) ||
      !action.sourceIds.length ||
      action.sourceIds.length > DREAM_MAX_SOURCES ||
      !action.sourceIds.every((id) => sources.has(id) && livedEvidence(sources.get(id)!))
    )
      continue;
    actions.set(action.id, action);
  }
  const seenImpulses = new Set<string>();
  const impulses: WakeImpulse[] = [];
  for (const proposed of proposal.impulses) {
    const action = actions.get(proposed.affordanceId);
    if (!action || seenImpulses.has(action.id)) continue;
    seenImpulses.add(action.id);
    const actionRefs = [...new Set(action.sourceIds)].map((id) => reference(sources.get(id)!));
    impulses.push({
      id: `${receiptId}:impulse:${impulses.length}`,
      visibility: 'private',
      version: 1,
      receiptId,
      sourceIds: actionRefs.map((source) => source.id),
      sources: actionRefs,
      affordanceId: action.id,
      targetId: action.targetId,
      action: action.action,
      reason: proposed.reason,
      retryCondition: action.retryCondition,
      createdAtReal: nowReal,
      expiresAtReal: Math.min(action.expiresAtReal, nowReal + MAX_IMPULSE_LIFETIME_MS),
      deferredUntilReal: null,
      status: 'pending',
    });
  }
  const annotations = new Map(
    state.annotations.map((annotation) => [annotation.memoryId, annotation]),
  );
  const newEvidence = new Set(request.newEvidenceIds);
  for (const update of (input.interpretations ?? []).slice(0, DREAM_MAX_SOURCES)) {
    if (
      !sources.has(update.memoryId) ||
      !shortText(update.text, 800) ||
      !Number.isFinite(update.retrievalOffset) ||
      !Array.isArray(update.sourceIds) ||
      !update.sourceIds.includes(update.memoryId) ||
      !update.sourceIds.length ||
      update.sourceIds.length > DREAM_MAX_SOURCES ||
      !update.sourceIds.every((id) => sources.has(id)) ||
      !update.sourceIds.some((id) => newEvidence.has(id)) ||
      (update.status !== undefined && !['active', 'unresolved', 'archived'].includes(update.status))
    )
      continue;
    const annotationRefs = [...new Set(update.sourceIds)].map((id) => reference(sources.get(id)!));
    annotations.set(update.memoryId, {
      kind: 'interpretation',
      visibility: 'private',
      memoryId: update.memoryId,
      sources: annotationRefs,
      text: update.text,
      status: update.status ?? 'active',
      retrievalOffset: Math.max(
        -DREAM_MAX_RETRIEVAL_OFFSET,
        Math.min(DREAM_MAX_RETRIEVAL_OFFSET, update.retrievalOffset),
      ),
      receiptId,
      updatedAtReal: nowReal,
    });
  }
  const receipt: DreamConsolidationReceipt = {
    id: receiptId,
    version: 1,
    visibility: 'private',
    idempotencyKey: requestKey,
    characterId: state.characterId,
    restSessionId: request.restSessionId,
    sourceWindow: { ...request.sourceWindow },
    sources: refs,
    completedAtReal: nowReal,
    dreamId,
    impulseIds: impulses.map((impulse) => impulse.id),
  };
  const dream: DreamRecord = {
    id: dreamId,
    kind: 'imagined-dream',
    visibility: 'private',
    version: 1,
    receiptId,
    restSessionId: request.restSessionId,
    createdAtReal: nowReal,
    sources: refs,
    vignette: proposal.vignette,
  };
  return {
    state: {
      ...state,
      pending: null,
      ledger: { ...state.ledger, lastConsolidatedAtReal: nowReal },
      annotations: [...annotations.values()].slice(-DREAM_MAX_SOURCES * MAX_HISTORY),
      dreams: [...state.dreams, dream].slice(-MAX_HISTORY),
      impulses: [
        ...state.impulses.filter(
          (impulse) => impulse.expiresAtReal > nowReal && impulse.status === 'pending',
        ),
        ...impulses,
      ].slice(-4),
      receipts: [...state.receipts, receipt].slice(-MAX_HISTORY),
    },
    receipt,
    reason: 'committed',
  };
}

/** Recovery clears an in-flight job; its real-clock/evidence reservation remains consumed. */
export function abandonDreamConsolidation(state: DreamState): DreamState {
  return state.pending ? { ...state, pending: null } : state;
}

/** Delete derived content if ANY supporting source was removed or revised; retain only anti-replay metadata. */
export function pruneDreamState(
  state: DreamState,
  currentSources: readonly DreamSource[],
): DreamState {
  const current = new Map(currentSources.map((source) => [source.id, source]));
  const valid = (refs: DreamSourceReference[]) =>
    refs.every((ref) => {
      const source = current.get(ref.id);
      return (
        source?.revision === ref.revision &&
        source.sourceEventId === ref.sourceEventId &&
        compactDigest(fingerprint(source)) === ref.contentFingerprint
      );
    });
  return {
    ...state,
    pending:
      state.pending &&
      state.pending.sources.every((source) => {
        const latest = current.get(source.id);
        return (
          latest &&
          latest.revision === source.revision &&
          fingerprint(latest) === fingerprint(source)
        );
      })
        ? state.pending
        : null,
    annotations: state.annotations.filter((annotation) => valid(annotation.sources)),
    dreams: state.dreams.filter((dream) => valid(dream.sources)),
    impulses: state.impulses.filter((impulse) => valid(impulse.sources)),
    receipts: state.receipts.filter((receipt) => valid(receipt.sources)),
  };
}

/** Modest ranking adjustments do not change source facts, identity, permission, risk or needs. */
export function dreamRankingOffsets(
  state: DreamState,
  currentSources: readonly DreamSource[],
): Record<string, number> {
  const pruned = pruneDreamState(state, currentSources);
  return Object.fromEntries(
    pruned.annotations
      .filter(
        (annotation) =>
          annotation.status === 'active' && Number.isFinite(annotation.retrievalOffset),
      )
      .map((annotation) => [
        annotation.memoryId,
        Math.max(
          -DREAM_MAX_RETRIEVAL_OFFSET,
          Math.min(DREAM_MAX_RETRIEVAL_OFFSET, annotation.retrievalOffset),
        ),
      ]),
  );
}

/** Planner preference only. Host must still recheck the action against current policy/world state. */
export function wakingDreamImpulses(state: DreamState, nowReal: number): WakeImpulse[] {
  if (
    !finiteTime(nowReal) ||
    (state.ledger.lastAttemptAtReal !== null && nowReal < state.ledger.lastAttemptAtReal)
  )
    return [];
  return state.impulses
    .filter(
      (impulse) =>
        impulse.status === 'pending' &&
        impulse.createdAtReal <= nowReal &&
        impulse.expiresAtReal > nowReal &&
        (impulse.deferredUntilReal === null || impulse.deferredUntilReal <= nowReal),
    )
    .slice(0, 2)
    .map((impulse) => structuredClone(impulse));
}

export function updateWakeImpulse(
  state: DreamState,
  impulseId: string,
  input:
    | { status: 'completed' | 'dismissed'; nowReal: number }
    | { status: 'deferred'; nowReal: number; untilReal: number },
): DreamState {
  if (!finiteTime(input.nowReal)) return state;
  return {
    ...state,
    impulses: state.impulses.map((impulse) => {
      if (
        impulse.id !== impulseId ||
        impulse.status !== 'pending' ||
        input.nowReal < impulse.createdAtReal ||
        input.nowReal >= impulse.expiresAtReal
      )
        return impulse;
      if (input.status === 'deferred') {
        if (!finiteTime(input.untilReal) || input.untilReal <= input.nowReal) return impulse;
        return { ...impulse, deferredUntilReal: Math.min(input.untilReal, impulse.expiresAtReal) };
      }
      return { ...impulse, status: input.status };
    }),
  };
}
