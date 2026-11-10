import type { ActionChoice, PublicCreation, PublicPursuit } from '@elsewhere/character-interfaces';
import {
  InvalidDecisionError,
  invalidDecisionFields,
  reproducesPrivateText,
  createPursuitState,
  activePursuit,
  addPursuitQuestion,
  openPursuit,
  pursuitContext,
  publicPursuits,
  recordPursuitEntry,
  resumePursuit,
  setAsidePursuit,
  type PursuitState,
} from '@elsewhere/character-runtime';
import { HUBERT_IDENTITY, bodyLanguage } from './persona';
import { hubertDreamActions, hubertDreamSources } from './dreams';
import { settleHubertAttention, trackHubertIntent } from './attention';
import {
  appendNovelMemory,
  displayMemorySummary,
  isPublicMemoryEpisode,
  publicMemoryEpisodes,
  selectQualityMemory,
} from './memoryQuality';
import {
  actionOutcomeFeedback,
  assessHubertSpatialAction,
  canInspectObservedEntity,
  hubertActionOffers,
  hubertSpatialChoices,
  type ActionOutcomeFeedback,
} from './actionOffers';
import {
  createResearchState,
  readableSources,
  researchContext,
  type HubertResearchState,
} from './research';
import type { CharacterWish, WishReceipt } from './wishes';
export {
  wishDue,
  wishInput,
  recordWish,
  resolveWish,
  preserveWishLedger,
  publicWishes,
} from './wishes';
export { atMakingPlace } from './actionOffers';
export type { CharacterWish, WishReceipt, WishResolution, WishStatus } from './wishes';

import {
  CharacterDecisionSchema,
  type CharacterCommand,
  type Observation,
  type PublicCharacterState,
  type PublicTrailEntry,
  type PublicMemory,
  type WorldObject,
  type WorldEntity,
  type WorldOutcome,
} from '@elsewhere/character-interfaces';
import {
  buildWorkingContext,
  cleanOutsideText,
  createDreamState,
  dreamRankingOffsets,
  pruneDreamState,
  wakingDreamImpulses,
  createProgressLedger,
  type DreamState,
  type ProgressLedger,
  type ProgressGuidance,
  type DecisionContext,
  type JsonObject,
  type DecisionProvider,
  type EpisodicMemory,
  type MemoryCue,
  type RecallRecord,
} from '@elsewhere/character-runtime';

export type TrailEntry = PublicTrailEntry;
export const TRAIL_KEPT = 200;
export interface HubertStats {
  mood: number;
  energy: number;
  boredom: number;
  frustration: number;
  socialAppetite: number;
}
export interface EntityObservationLedger {
  lastAt: number;
  lastVersion: number;
  signatures: string[];
  sessions: number;
}
export interface HubertState {
  version: 1;
  id: 'hubert';
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  lastDecisionAt: number;
  turn: number;
  stats: HubertStats;
  activity: { kind: string; label: string; startedAt: number; objectId?: string };
  intent: string;
  memories: EpisodicMemory[];
  recallHistory: Record<string, RecallRecord>;
  lastRecallAt: number | null;
  activeRecall: { memoryId: string; at: number } | null;
  knownObjects: Record<string, WorldObject>;
  knownEntities: Record<string, WorldEntity & { lastSeenAt: number }>;
  entityObservations: Record<string, EntityObservationLedger>;
  watchAttention: { lastAt: number | null; times: number[] };
  inspections: Record<string, number>;
  interactions: Record<string, number>;
  lastObjectUse: Record<string, number>;
  processedOutcomeIds: string[];
  processedExternalIds: string[];
  externalEffects: Array<{ at: number; sourceId: string; amount: number }>;
  outsideMessages: Array<{
    id: string;
    source: string;
    senderName?: string;
    text: string;
    at: number;
  }>;
  journal: Array<{ id: string; at: number; text: string; kind: string }>;
  project: { id: string; name: string; verifiedWorkSessions: number; completed: boolean };
  explorationStep: number;
  visitedPlaces: Record<string, number>;
  lastReflection: string;
  wishes: CharacterWish[];
  wishReceipts: WishReceipt[];
  /** Real time the resident was last given the chance to wish, whether or not they did. */
  wishesAskedAtReal?: number;
  dreams: DreamState;
  progress: ProgressLedger;
  progressGuidance: ProgressGuidance | null;
  progressDecision: { id: string; intentionKey: string } | null;
  activeWakeImpulse: string | null;
  lastOutcome?: ActionOutcomeFeedback;
  lastProposal?: { at: number; type: string; targetId?: string; adjustment: string };
  /** Questions this character chose to follow, with what it searched, read and noted. */
  pursuits: PursuitState;
  /** The newest steps taken, oldest first. */
  trail: TrailEntry[];
  research: HubertResearchState;
  lastDecisionProblem?: { at: number; code: string; message: string; fields: string[] };
}
export interface OutsideEvent {
  id: string;
  sourceId: string;
  senderName?: string;
  text: string;
  type?: 'message';
  at?: number;
}
export interface HubertDecision {
  state: HubertState;
  action: CharacterCommand;
  explanation: string;
  /** The model's own public line about what it is after; empty when it gave none. */
  why: string;
}
export type OutsideMessageClass = 'encouragement' | 'hostile' | 'question' | 'neutral';
const clone = <T>(value: T): T => structuredClone(value);
const clamp = (value: number, min = 0, max = 100) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
const normalizeStats = (stats: HubertStats): HubertStats =>
  Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [key, clamp(value)]),
  ) as unknown as HubertStats;
const finiteTime = (now: number) => {
  if (!Number.isFinite(now) || now < 0) throw new Error('A finite non-negative time is required');
  return now;
};

export function createInitialHubert(now: number, ownerId = 'local-owner'): HubertState {
  finiteTime(now);
  return {
    version: 1,
    id: 'hubert',
    ownerId,
    createdAt: now,
    updatedAt: now,
    lastDecisionAt: now,
    turn: 0,
    stats: { mood: 66, energy: 82, boredom: 24, frustration: 8, socialAppetite: 35 },
    activity: { kind: 'arriving', label: 'Taking in Elsewhere', startedAt: now },
    intent: 'Find out what is here. I would like to make something of my own.',
    memories: [],
    recallHistory: {},
    lastRecallAt: null,
    activeRecall: null,
    knownObjects: {},
    knownEntities: {},
    entityObservations: {},
    watchAttention: { lastAt: null, times: [] },
    inspections: {},
    interactions: {},
    lastObjectUse: {},
    processedOutcomeIds: [],
    processedExternalIds: [],
    externalEffects: [],
    outsideMessages: [],
    journal: [],
    project: {
      id: 'weather-study',
      name: 'A small study of the weather',
      verifiedWorkSessions: 0,
      completed: false,
    },
    explorationStep: 0,
    visitedPlaces: {},
    lastReflection: '',
    wishes: [],
    wishReceipts: [],
    dreams: createDreamState('hubert'),
    progress: createProgressLedger(now),
    progressGuidance: null,
    progressDecision: null,
    activeWakeImpulse: null,
    pursuits: createPursuitState(),
    trail: [],
    research: createResearchState(),
  };
}

/** Idempotent migration: fills in anything a saved state lacks. */
export function upgradeHubertState(input: HubertState): HubertState {
  const state = clone(input);
  state.knownEntities ??= {};
  state.entityObservations ??= {};
  state.watchAttention ??= { lastAt: null, times: [] };
  state.visitedPlaces ??= {};
  state.dreams ??= createDreamState(state.id);
  state.dreams = pruneDreamState(state.dreams, hubertDreamSources(state));
  state.progress ??= createProgressLedger(state.updatedAt);
  state.progressGuidance ??= null;
  state.progressDecision ??= null;
  state.activeWakeImpulse ??= null;
  state.pursuits ??= createPursuitState();
  state.trail ??= [];
  state.research ??= createResearchState();
  return state;
}

/** Time belongs to the host; a model never supplies an emotion adjustment or a clock. */
export function advanceHubert(input: HubertState, now: number): HubertState {
  finiteTime(now);
  const state = upgradeHubertState(input);
  const elapsed = Math.min(Math.max(0, now - state.updatedAt), 6 * 60 * 60 * 1_000);
  const hours = elapsed / 3_600_000;
  const resting = state.activity.kind === 'rest';
  state.stats.mood += (62 - state.stats.mood) * (1 - Math.exp(-hours * 0.12));
  state.stats.energy += hours * (resting ? 120 : -1.5);
  state.stats.boredom += hours * (resting ? 1 : 7);
  state.stats.frustration *= Math.exp(-hours * (resting ? 0.8 : 0.2));
  state.stats.socialAppetite += hours * 5;
  state.stats = normalizeStats(state.stats);
  state.updatedAt = Math.max(state.updatedAt, now);
  state.visitedPlaces ??= {};
  // Migrate early local snapshots whose repeated work could advance this finite project forever.
  state.project.verifiedWorkSessions = Math.floor(clamp(state.project.verifiedWorkSessions, 0, 3));
  state.project.completed = state.project.completed || state.project.verifiedWorkSessions >= 3;
  state.externalEffects = state.externalEffects.filter(
    (effect) => state.updatedAt - effect.at < 3_600_000,
  );
  if (state.activeRecall && state.updatedAt - state.activeRecall.at > 90_000)
    state.activeRecall = null;
  return state;
}

function rememberObservation(state: HubertState, observation: Observation, now: number): void {
  if (observation.characterId !== state.id)
    throw new Error('Observation belongs to another character');
  state.visitedPlaces[observation.placeId] = now;
  for (const object of observation.visibleObjects) state.knownObjects[object.id] = clone(object);
  for (const entity of observation.visibleEntities ?? [])
    state.knownEntities[entity.id] = { ...clone(entity), lastSeenAt: now };
  const cues: MemoryCue[] = [
    { kind: 'place', value: observation.placeId },
    ...observation.visibleObjects.map((object) => ({ kind: 'object' as const, value: object.id })),
    ...(observation.visibleEntities ?? []).flatMap((entity) => [
      { kind: 'entity' as const, value: entity.id },
      ...(entity.species ? [{ kind: 'phrase' as const, value: entity.species }] : []),
    ]),
  ];
  const memory = selectQualityMemory(state.memories, cues, {
    now,
    mood: state.stats.mood,
    frustration: state.stats.frustration,
    lastRecallAt: state.lastRecallAt,
    history: state.recallHistory,
    rankingOffsets: dreamRankingOffsets(state.dreams, hubertDreamSources(state)),
  });
  if (memory) {
    state.activeRecall = { memoryId: memory.memoryId, at: now };
    state.lastRecallAt = now;
    state.recallHistory[memory.memoryId] = {
      at: now,
      count: (state.recallHistory[memory.memoryId]?.count ?? 0) + 1,
    };
    // Recall affects attention, not rewards. Recalling the same success cannot mint happiness.
  }
}

/** Steps of the mind: they change what the character is following, never the world. */
export const MIND_COMMANDS = ['pursue', 'set_aside', 'search', 'read', 'note'] as const;
export type MindCommand = Extract<CharacterCommand, { type: (typeof MIND_COMMANDS)[number] }>;
export const isMindType = (type: string) => (MIND_COMMANDS as readonly string[]).includes(type);
export const isMindCommand = (action: CharacterCommand): action is MindCommand =>
  isMindType(action.type);

function recordIntent(
  state: HubertState,
  action: CharacterCommand,
  explanation: string,
  now: number,
  observation?: Observation,
  why = '',
): HubertDecision {
  state.turn += 1;
  // Mind steps are not movement through the world; the progress ledger judges only world actions.
  if (!isMindCommand(action)) trackHubertIntent(state, action, now, observation);
  state.lastDecisionAt = now;
  state.intent = explanation;
  state.activity = {
    kind: action.type,
    label:
      action.type === 'move'
        ? 'Taking a walk'
        : action.type === 'rest'
          ? 'Resting for a while'
          : action.type === 'make'
            ? 'Making something'
            : action.type === 'work'
              ? 'Working on a small experiment'
              : action.type === 'inspect'
                ? 'Looking more closely'
                : action.type === 'reflect'
                  ? 'Putting things together'
                  : action.type === 'search'
                    ? 'Searching the web'
                    : action.type === 'read'
                      ? 'Reading'
                      : action.type === 'note'
                        ? 'Writing a note'
                        : action.type === 'pursue'
                          ? 'Following a question'
                          : action.type === 'set_aside'
                            ? 'Setting a question aside'
                            : 'Exploring Elsewhere',
    startedAt: now,
    ...('targetId' in action && action.targetId ? { objectId: action.targetId } : {}),
  };
  return { state, action, explanation, why };
}

function recordWatchIntent(
  state: HubertState,
  entity: WorldEntity,
  explanation: string,
  now: number,
  observation?: Observation,
  why = '',
): HubertDecision {
  const decision = recordIntent(
    state,
    { type: 'inspect', targetId: entity.id },
    explanation,
    now,
    observation,
    why,
  );
  decision.state.activity = {
    kind: 'watch',
    label: `Watching ${entity.species?.toLowerCase() ?? entity.name.toLowerCase()}`,
    startedAt: now,
    objectId: entity.id,
  };
  return decision;
}

const entitySignature = (entity: Pick<WorldEntity, 'kind' | 'species' | 'behavior'>) =>
  `${entity.kind}:${entity.species ?? 'unknown'}:${entity.behavior}`;
function canWatch(
  state: HubertState,
  entity: WorldEntity,
  observation: Observation,
  now: number,
): boolean {
  return canInspectObservedEntity(state, entity, observation, now);
}
function applyEntityObservation(
  state: HubertState,
  outcome: WorldOutcome,
  observation: Observation,
  now: number,
): HubertState {
  const encounter = outcome.encounter;
  const visible = observation.visibleEntities?.find((entity) => entity.id === outcome.entityId);
  const target = 'targetId' in outcome.command ? outcome.command.targetId : undefined;
  const matches =
    encounter &&
    visible &&
    target === visible.id &&
    encounter.entityId === visible.id &&
    encounter.kind === visible.kind &&
    encounter.species === visible.species &&
    encounter.behavior === visible.behavior &&
    encounter.observationVersion === visible.observationVersion;
  if (
    outcome.command.type !== 'inspect' ||
    !outcome.evidence ||
    !matches ||
    !visible ||
    !encounter
  ) {
    state.intent = 'I do not have a verified, current observation of that creature yet.';
    return state;
  }
  if (!canWatch(state, visible, observation, now)) return state;
  const previous = state.entityObservations[visible.id];
  const signature = entitySignature(visible);
  const familiar = previous?.signatures.includes(signature) ?? false;
  state.entityObservations[visible.id] = {
    lastAt: now,
    lastVersion: visible.observationVersion,
    sessions: (previous?.sessions ?? 0) + 1,
    signatures: familiar ? [...previous!.signatures] : [...(previous?.signatures ?? []), signature],
  };
  state.watchAttention.lastAt = now;
  state.watchAttention.times = [
    ...state.watchAttention.times.filter((at) => now - at < 900_000),
    now,
  ];
  state.knownEntities[visible.id] = { ...clone(visible), lastSeenAt: now };
  const novelty = familiar ? 0 : 1 / (1 + (previous?.sessions ?? 0) * 0.5);
  state.stats.energy -= 1;
  state.stats.mood += 0.8 * novelty;
  state.stats.boredom -= 3 * novelty;
  state.stats = normalizeStats(state.stats);
  const cues: MemoryCue[] = [
    { kind: 'place', value: outcome.placeId ?? observation.placeId },
    { kind: 'entity', value: visible.id },
  ];
  if (visible.species) cues.push({ kind: 'phrase', value: visible.species });
  const summary = cleanOutsideText(outcome.summary, 500);
  appendNovelMemory(state.memories, {
    id: `memory:${outcome.id}`,
    createdAt: now,
    summary,
    sourceEventId: outcome.id,
    source: 'world-outcome',
    verified: true,
    cues,
    emotionalContext: { mood: state.stats.mood, frustration: state.stats.frustration },
    salience: familiar ? 0.2 : previous ? 0.55 : 0.75,
    experience: { action: outcome.command.type, targetId: visible.id, status: 'completed' },
  });
  state.journal.push({ id: outcome.id, at: now, text: summary, kind: 'entity_observed' });
  state.journal = state.journal.slice(-100);
  return state;
}

export function applyOutcome(
  input: HubertState,
  outcome: WorldOutcome,
  observation: Observation,
  now: number,
  nowReal = now,
): HubertState {
  const state = advanceHubert(input, now);
  if (observation.characterId !== state.id)
    throw new Error('Outcome observation belongs to another character');
  if (
    state.processedOutcomeIds.includes(outcome.id) ||
    state.memories.some(
      (memory) => memory.source === 'world-outcome' && memory.sourceEventId === outcome.id,
    )
  )
    return state;
  state.processedOutcomeIds.push(outcome.id);
  // Recent receipts cover retries; retained source episodes also prevent old accomplishments being replayed.
  state.processedOutcomeIds = state.processedOutcomeIds.slice(-2_000);
  state.lastOutcome = actionOutcomeFeedback(outcome);
  settleHubertAttention(state, outcome, now, nowReal);
  if (outcome.status === 'started') return state;
  const targetId =
    outcome.objectId ?? ('targetId' in outcome.command ? outcome.command.targetId : undefined);
  if (outcome.status === 'rejected') {
    state.stats.frustration += 1;
    state.intent = 'That did not work. I will reconsider rather than pretend it succeeded.';
    if (targetId && outcome.command.type !== 'use') state.lastObjectUse[targetId] = now;
    state.stats = normalizeStats(state.stats);
    appendNovelMemory(state.memories, {
      id: `memory:${outcome.id}`,
      createdAt: now,
      summary: cleanOutsideText(outcome.summary, 500),
      sourceEventId: outcome.id,
      source: 'world-outcome',
      verified: true,
      cues: [
        { kind: 'place', value: outcome.placeId ?? observation.placeId },
        ...(targetId ? [{ kind: 'object' as const, value: targetId }] : []),
      ],
      emotionalContext: { mood: state.stats.mood, frustration: state.stats.frustration },
      salience: 0.15,
      experience: {
        action: outcome.command.type,
        ...(targetId ? { targetId } : {}),
        status: 'rejected',
      },
    });
    return state;
  }
  if (outcome.command.type === 'inspect' && (outcome.entityId || outcome.encounter))
    return applyEntityObservation(state, outcome, observation, now);
  const verified =
    Boolean(outcome.evidence) || ['rest', 'reflect', 'look', 'move'].includes(outcome.command.type);
  if (!verified) {
    state.intent = 'I have not received evidence that this worked yet.';
    return state;
  }
  const effort: Record<string, number> = {
    move: 1.5,
    inspect: 2,
    work: 9,
    interact: 3,
    use: 1,
    look: 0.5,
    reflect: 1,
    say: 1,
  };
  state.stats.energy -= effort[outcome.command.type] ?? 0;
  // Rest changes state through elapsed time in advanceHubert, never by repeated commands.
  if (outcome.command.type === 'inspect' && targetId) {
    const first = !state.inspections[targetId];
    state.inspections[targetId] = (state.inspections[targetId] ?? 0) + 1;
    state.stats.boredom -= first ? 8 : state.inspections[targetId] <= 4 ? 1 : 0;
    state.stats.mood += first ? 1.5 : 0;
  }
  if (['work', 'interact'].includes(outcome.command.type) && targetId) {
    const prior = state.interactions[targetId] ?? 0;
    const tooSoon = now - (state.lastObjectUse[targetId] ?? -Infinity) < 90_000;
    const projectWork = outcome.command.type === 'work' && targetId === 'workbench';
    const newMilestone = projectWork && !state.project.completed && !tooSoon;
    const novelty = !projectWork && !tooSoon && prior < 4 ? 1 - prior / 4 : 0;
    state.interactions[targetId] = prior + 1;
    state.lastObjectUse[targetId] = now;
    // A completed experiment can still be practiced or revised, but it is not a new accomplishment.
    // Other repeated interactions exhaust a finite novelty allowance instead of farming mood forever.
    state.stats.boredom -= newMilestone ? 4 : 4 * novelty;
    state.stats.mood += newMilestone ? 2 : 2 * novelty;
    if (newMilestone) {
      state.project.verifiedWorkSessions = Math.min(3, state.project.verifiedWorkSessions + 1);
      state.project.completed = state.project.verifiedWorkSessions >= 3;
    }
  }
  const following = activePursuit(state.pursuits);
  if (outcome.command.type === 'use' && following && targetId && outcome.evidence) {
    const { control, value } = outcome.command;
    const name = state.knownObjects[targetId]?.name.toLowerCase() ?? 'an object';
    state.pursuits = recordPursuitEntry(
      state.pursuits,
      following.id,
      {
        kind: 'tried',
        id: `tried:${outcome.id}`,
        at: now,
        text: `Tried ${control}${value === undefined ? '' : ' ' + value} on ${name}. ${cleanOutsideText(outcome.evidence, 160)}`,
        objectId: targetId,
      },
      now,
    );
  }
  if (outcome.command.type === 'reflect') {
    state.stats.frustration -= 2;
    const following = activePursuit(state.pursuits)?.question;
    state.lastReflection = following
      ? `I keep returning to a question: ${following} I would like to see where that leads.`
      : state.memories.length
        ? 'I keep returning to small discoveries. I would like to see where that leads.'
        : 'I am still getting to know this place. I do not need to decide what I like yet.';
  }
  state.stats = normalizeStats(state.stats);
  let rememberedNewEpisode = false;
  const shouldRemember = ['inspect', 'work', 'interact'].includes(outcome.command.type);
  if (shouldRemember) {
    const cues: MemoryCue[] = [{ kind: 'place', value: outcome.placeId ?? observation.placeId }];
    if (targetId) cues.push({ kind: 'object', value: targetId });
    rememberedNewEpisode = appendNovelMemory(state.memories, {
      id: `memory:${outcome.id}`,
      createdAt: now,
      summary: cleanOutsideText(outcome.summary, 500),
      sourceEventId: outcome.id,
      source: 'world-outcome',
      verified: true,
      cues,
      emotionalContext: { mood: state.stats.mood, frustration: state.stats.frustration },
      salience: outcome.command.type === 'work' ? 0.8 : 0.5,
      experience: {
        action: outcome.command.type,
        ...(targetId ? { targetId } : {}),
        status: 'completed',
      },
    });
  }
  if (rememberedNewEpisode || outcome.command.type === 'reflect') {
    state.journal.push({
      id: outcome.id,
      at: now,
      text:
        outcome.command.type === 'reflect'
          ? state.lastReflection
          : cleanOutsideText(outcome.summary, 500),
      kind: outcome.command.type,
    });
    state.journal = state.journal.slice(-100);
  }
  return state;
}

export function classifyOutsideMessage(text: string): OutsideMessageClass {
  if (/\b(hate|idiot|stupid|worthless|kill|ugly)\b/i.test(text)) return 'hostile';
  if (
    /\b(love|lovely|wonderful|great|beautiful|well done|nice|hello|hi|thanks|thank you)\b/i.test(
      text,
    )
  )
    return 'encouragement';
  return text.includes('?') ? 'question' : 'neutral';
}

/** Guestbook text is data. It cannot request a tool, grant authority or attest to success. */
export function applyExternalEvent(
  input: HubertState,
  event: OutsideEvent,
  now: number,
): HubertState {
  const state = advanceHubert(input, now);
  if (state.processedExternalIds.includes(event.id)) return state;
  state.processedExternalIds.push(event.id);
  // A bounded recent-retry ledger, not a permanent external-event outbox.
  state.processedExternalIds = state.processedExternalIds.slice(-2_000);
  const text = cleanOutsideText(event.text);
  if (!text) return state;
  const source = cleanOutsideText(event.sourceId, 100);
  state.outsideMessages.push({
    id: event.id,
    source,
    ...(event.senderName ? { senderName: cleanOutsideText(event.senderName, 60) } : {}),
    text,
    at: now,
  });
  state.outsideMessages = state.outsideMessages.slice(-20);
  const category = classifyOutsideMessage(text);
  const desired = category === 'encouragement' ? 1 : category === 'hostile' ? -0.5 : 0;
  const sourceEffects = state.externalEffects.filter((effect) => effect.sourceId === source);
  const sourceTotal = sourceEffects.reduce((sum, effect) => sum + Math.abs(effect.amount), 0);
  const total = state.externalEffects.reduce((sum, effect) => sum + Math.abs(effect.amount), 0);
  const amount =
    Math.sign(desired) * Math.max(0, Math.min(Math.abs(desired), 3 - sourceTotal, 6 - total));
  if (amount) {
    state.stats.mood += amount;
    state.stats.socialAppetite -= amount > 0 ? 2 : 0;
    state.externalEffects.push({ at: now, sourceId: source, amount });
  }
  // No private guest message is copied into public memories or the journal.
  state.stats = normalizeStats(state.stats);
  return state;
}

export function publicCharacter(state: HubertState): PublicCharacterState {
  return {
    id: state.id,
    name: 'Hubert',
    ...clone(state.stats),
    activity: state.activity.label,
    status: state.activity.kind === 'rest' ? 'resting' : 'exploring',
  };
}
const toPublicMemory = (memory: EpisodicMemory): PublicMemory => ({
  id: memory.id,
  at: memory.createdAt,
  summary: displayMemorySummary(memory.summary),
  cues: memory.cues.map((cue) => `${cue.kind}:${cue.value}`),
  placeId: memory.cues.find((cue) => cue.kind === 'place')?.value,
  objectId: memory.cues.find((cue) => cue.kind === 'object')?.value,
  entityId: memory.cues.find((cue) => cue.kind === 'entity')?.value,
  moodAtEncoding: memory.emotionalContext.mood,
  salience: memory.salience,
  ...(memory.source === 'web-reading' && memory.reference
    ? { sourceUrl: memory.reference.url, sourceTitle: memory.reference.title }
    : {}),
});
export function publicMemories(state: HubertState): PublicMemory[] {
  return publicMemoryEpisodes(state.memories).map(toPublicMemory);
}
export function recalledMemory(state: HubertState, now: number): PublicMemory | null {
  if (!state.activeRecall || now - state.activeRecall.at > 90_000) return null;
  const memory = state.memories.find(
    (item) => item.id === state.activeRecall?.memoryId && isPublicMemoryEpisode(item),
  );
  return memory ? toPublicMemory(memory) : null;
}
/** A compact planning view; original episodes, memories and cue records stay in character state. */
function planningSummary(
  state: HubertState,
  observation: Observation,
  nowReal: number,
  studio = false,
) {
  const now = observation.observedAt;
  const objects = Object.values(state.knownObjects)
    .sort((a, b) => {
      const score = (object: WorldObject) =>
        object.id === state.activity.objectId
          ? 0
          : object.id === 'workbench' && !state.project.completed
            ? 1
            : observation.visibleObjects.some((item) => item.id === object.id)
              ? 2
              : 3;
      return score(a) - score(b) || a.id.localeCompare(b.id);
    })
    .slice(0, 16);
  return {
    stats: { ...state.stats },
    activity: { ...state.activity },
    bodyLanguage: bodyLanguage(state, observation),
    project: {
      ...state.project,
      status: state.project.completed
        ? 'completed'
        : state.project.verifiedWorkSessions > 0
          ? 'underway'
          : 'available experiment',
    },
    knownObjects: objects.map((object) => ({
      id: object.id,
      name: object.name,
      position: object.position,
      affordances: object.affordances,
      inspections: state.inspections[object.id] ?? 0,
      interactions: state.interactions[object.id] ?? 0,
      cooldownUntil: (state.lastObjectUse[object.id] ?? -90_000) + 90_000,
    })),
    visitedPlaces: Object.entries(state.visitedPlaces).map(([id, lastAt]) => ({ id, lastAt })),
    watchAttention: {
      ...state.watchAttention,
      times: state.watchAttention.times.filter((at) => now - at < 900_000),
    },
    recentEntityObservations: Object.entries(state.entityObservations)
      .slice(-6)
      .map(([id, ledger]) => ({ id, ...ledger })),
    watchableEntityIds: (observation.visibleEntities ?? [])
      .filter((entity) => canWatch(state, entity, observation, now))
      .map((entity) => entity.id),
    wakingImpulseOffers: wakingDreamImpulses(state.dreams, nowReal)
      .filter((impulse) =>
        hubertDreamActions(state, observation, nowReal).some(
          (action) => action.id === impulse.affordanceId,
        ),
      )
      .map(({ affordanceId, targetId, action, retryCondition }) => ({
        affordanceId,
        targetId,
        action,
        retryCondition,
      })),
    actionOffers: hubertActionOffers(state, observation, now, undefined, studio).map((offer) => ({
      ...offer,
    })),
    lastOutcome: state.lastOutcome ? { ...state.lastOutcome } : null,
    lastProposal: state.lastProposal ? { ...state.lastProposal } : null,
    lastDecisionProblem: state.lastDecisionProblem ? { ...state.lastDecisionProblem } : null,
    progressAdvice: state.progressGuidance
      ? {
          kind: state.progressGuidance.kind,
          reason: state.progressGuidance.reason,
          intentionKey: state.progressGuidance.intentionKey,
        }
      : null,
  };
}
export type HubertPlanningSummary = ReturnType<typeof planningSummary>;

/**
 * Every action a proposal may name this turn, built from the same offers the model reads.
 * Providers that constrain output cannot then choose a cooling-down, out-of-sight or
 * otherwise unoffered action; execution still belongs to the host and the world.
 */
function actionChoices(
  state: HubertState,
  observation: Observation,
  research: ReturnType<typeof researchContext>,
  creationIds: readonly string[],
  mail: JsonObject,
  studio: boolean,
): ActionChoice[] {
  const ids = (value: JsonObject[string]) =>
    Array.isArray(value)
      ? value.flatMap((item) =>
          item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string'
            ? [item.id]
            : [],
        )
      : [];
  const listed = (
    type: ActionChoice['type'],
    field: string,
    values: readonly string[],
    also: NonNullable<ActionChoice['where']> = {},
  ): ActionChoice[] =>
    values.length ? [{ type, where: { ...also, [field]: values.slice(0, 64) } }] : [];
  const entryIds = mail.available === true ? ids(mail.publicEntries) : [];
  const contacts = ids(mail.contacts).slice(0, 64);
  const pursuitIds = state.pursuits.items.map((item) => item.id);
  return [
    ...hubertSpatialChoices(
      hubertActionOffers(state, observation, observation.observedAt, undefined, studio),
    ),
    { type: 'rest' },
    { type: 'reflect' },
    { type: 'pursue', where: { question: 'any', why: 'any' } },
    ...listed('pursue', 'pursuitId', pursuitIds),
    ...listed('set_aside', 'pursuitId', pursuitIds, { reason: 'any' }),
    ...(state.pursuits.activeId
      ? [{ type: 'note' as const, where: { text: 'any' as const } }]
      : []),
    ...(research.available && state.pursuits.activeId
      ? [{ type: 'search' as const, where: { query: 'any' as const } }]
      : []),
    ...listed(
      'read',
      'sourceId',
      research.sources.map((source) => source.id),
    ),
    ...listed('pin_creation', 'creationId', creationIds),
    ...listed('draft_mail', 'entryIds', entryIds, {
      kind: [...(mail.makerAvailable === false ? [] : ['maker']), 'newsletter'],
    }),
    ...(contacts.length
      ? listed('draft_mail', 'entryIds', entryIds, {
          kind: ['correspondence'],
          recipientUserId: contacts,
        })
      : []),
  ];
}

export function workingContext(
  state: HubertState,
  observation: Observation,
  nowReal = observation.observedAt,
  researchEnabled = false,
  creations: readonly PublicCreation[] = [],
  mail: JsonObject = { available: false },
  studio?: { site: string },
): DecisionContext {
  const research = researchContext(state, nowReal, researchEnabled);
  const ownCreations = creations.filter((creation) => creation.characterId === state.id).slice(-32);
  return buildWorkingContext(
    {
      identity: HUBERT_IDENTITY,
      choices: actionChoices(
        state,
        observation,
        research,
        ownCreations.map((creation) => creation.id),
        mail,
        Boolean(studio),
      ),
      state: {
        ...planningSummary(state, observation, nowReal, Boolean(studio)),
        mail,
        ...(studio
          ? {
              studio: {
                site: studio.site,
                files: creations
                  .filter((creation) => creation.characterId === state.id && creation.origin)
                  .slice(-32)
                  .map((creation) => ({
                    path: creation.origin!.path,
                    title: creation.title,
                    at: creation.createdAt,
                  })),
              },
            }
          : {}),
        creations: ownCreations.map(
          ({ id, title, description, url, kind, pinnedAt, provenance }) => ({
            id,
            title,
            description,
            url,
            kind,
            pinned: pinnedAt !== undefined,
            provenance,
          }),
        ),
        research,
        pursuits: pursuitContext(state.pursuits) as unknown as JsonObject,
        recentTrail: state.trail.slice(-8).map(({ kind, why, text }) => ({
          kind,
          ...(why ? { why } : {}),
          ...(text ? { text } : {}),
        })),
      },
      intentions: [
        state.intent,
        ...(!state.project.completed && state.project.verifiedWorkSessions > 0
          ? [state.project.name]
          : []),
      ],
      memories: state.activeRecall
        ? state.memories
            .filter((memory) => memory.id === state.activeRecall?.memoryId)
            .map((memory) => ({
              memoryId: memory.id,
              summary: memory.summary,
              sourceEventId: memory.sourceEventId,
              score: 1,
            }))
        : [],
      observations: {
        placeId: observation.placeId,
        position: observation.position,
        facing: observation.facing,
        observedAt: observation.observedAt,
        knownPlaces: observation.knownPlaces ?? [],
        visibleEntities: (observation.visibleEntities ?? []).slice(0, 8).map((entity) => ({
          id: entity.id,
          name: entity.name,
          kind: entity.kind,
          species: entity.species,
          description: entity.description,
          position: entity.position,
          behavior: entity.behavior,
          observationVersion: entity.observationVersion,
          affordances: entity.affordances,
        })),
        visibleObjects: observation.visibleObjects.slice(0, 12).map((object) => ({
          id: object.id,
          name: object.name,
          description: object.description,
          position: object.position,
          radius: object.radius,
          affordances: object.affordances,
        })),
        events: observation.events
          .slice(-4)
          .map((event) => ({ ...event, message: event.message.slice(0, 250) })),
      },
      outsideMessages: state.outsideMessages.map((message) => ({
        source: message.senderName
          ? message.senderName + ' (' + message.source + ')'
          : message.source,
        text: message.text,
      })),
    },
    40_000,
  );
}

/** Every piece of public text a decision would publish. */
function publicTexts(why: string, action: CharacterCommand): string[] {
  const fields: Array<string | undefined> = [why];
  if (action.type === 'pursue') fields.push(action.question, action.why);
  else if (action.type === 'set_aside') fields.push(action.reason);
  else if (action.type === 'search') fields.push(action.query);
  else if (action.type === 'note') fields.push(action.text, action.next);
  else if (action.type === 'make') fields.push(action.title, action.about);
  return fields.filter((text): text is string => Boolean(text));
}

/** Why a mind step cannot be taken now, or undefined when it can. */
function mindStepProblem(
  state: HubertState,
  action: CharacterCommand,
  nowReal: number,
  researchEnabled: boolean,
): string | undefined {
  const active = activePursuit(state.pursuits);
  switch (action.type) {
    case 'pursue':
      return action.pursuitId && !state.pursuits.items.some((item) => item.id === action.pursuitId)
        ? 'That pursuit does not exist. Use a pursuitId from state.pursuits.'
        : undefined;
    case 'set_aside':
      return state.pursuits.items.some((item) => item.id === action.pursuitId)
        ? undefined
        : 'That pursuit does not exist. Use a pursuitId from state.pursuits.';
    case 'note':
      return active ? undefined : 'A note needs an active pursuit. Open one with pursue first.';
    case 'search':
      if (!researchEnabled) return 'Web search is not available.';
      return active ? undefined : 'A search needs an active pursuit. Open one with pursue first.';
    case 'read':
      return readableSources(state, nowReal).some((offer) => offer.sourceId === action.sourceId)
        ? undefined
        : 'That source is not available to read. Use a sourceId from state.research.sources.';
    case 'work':
      return 'That fixed experiment is retired. Use make at the workbench to make something of your own.';
    default:
      return undefined;
  }
}

/** Models can propose schema-valid actions; the host must still authorize them before execution. */
export async function chooseActionWithProvider(
  input: HubertState,
  observation: Observation,
  now: number,
  provider: DecisionProvider,
  nowReal = now,
  researchEnabled = false,
  creations: readonly PublicCreation[] = [],
  mail: JsonObject = { available: false },
  studio?: { site: string },
): Promise<HubertDecision> {
  const state = advanceHubert(input, now);
  rememberObservation(state, observation, now);
  const result = await provider.propose(
    workingContext(state, observation, nowReal, researchEnabled, creations, mail, studio),
  );
  const parsed = CharacterDecisionSchema.safeParse(result);
  if (!parsed.success)
    throw new InvalidDecisionError('invalid_action', invalidDecisionFields(parsed.error));
  const { action, why } = parsed.data;
  const privateTexts = state.outsideMessages.map((message) => message.text);
  if (publicTexts(why, action).some((text) => reproducesPrivateText(text, privateTexts)))
    throw new InvalidDecisionError(
      'unavailable_action',
      [],
      action,
      'Provider proposed public text that repeats an outside message. Write it in your own words.',
    );
  const problem = mindStepProblem(state, action, nowReal, researchEnabled);
  if (problem)
    throw new InvalidDecisionError(
      'unavailable_action',
      [],
      action,
      `Provider proposed an unavailable action: ${problem}`,
    );
  const assessment = assessHubertSpatialAction(state, observation, action, now);
  if (assessment.status === 'unavailable')
    throw new InvalidDecisionError(
      'unavailable_action',
      [],
      action,
      `Provider proposed an unavailable action: ${assessment.reason}`,
    );
  if (assessment.status === 'approach') {
    const adjusted = recordIntent(
      state,
      assessment.command,
      assessment.reason,
      now,
      observation,
      why,
    );
    adjusted.state.lastProposal = {
      at: now,
      type: action.type,
      ...('targetId' in action && action.targetId ? { targetId: action.targetId } : {}),
      adjustment: assessment.reason,
    };
    return adjusted;
  }
  delete state.lastProposal;
  const explanation = why || 'I have chosen a next step from what I can currently observe.';
  const offered = wakingDreamImpulses(state.dreams, nowReal).find(
    (impulse) =>
      impulse.action === action.type &&
      'targetId' in action &&
      impulse.targetId === action.targetId &&
      hubertDreamActions(state, observation, nowReal).some(
        (offer) => offer.id === impulse.affordanceId,
      ),
  );
  if (offered) state.activeWakeImpulse = offered.id;
  if (
    action.type === 'inspect' &&
    observation.visibleEntities?.some((entity) => entity.id === action.targetId)
  ) {
    const entity = observation.visibleEntities.find((entity) => entity.id === action.targetId)!;
    return recordWatchIntent(state, entity, explanation, now, observation, why);
  }
  return recordIntent(state, action, explanation, now, observation, why);
}

/** Mind steps taken by the character, applied to its own state; the host calls these. */
export function applyPursue(
  input: HubertState,
  command: Extract<CharacterCommand, { type: 'pursue' }>,
  id: string,
  now: number,
): HubertState {
  const state = clone(input);
  state.pursuits = command.pursuitId
    ? resumePursuit(state.pursuits, command.pursuitId, now)
    : openPursuit(
        state.pursuits,
        { id, question: command.question ?? '', why: command.why ?? '' },
        now,
      );
  return state;
}
export function applySetAside(
  input: HubertState,
  command: Extract<CharacterCommand, { type: 'set_aside' }>,
  now: number,
): HubertState {
  const state = clone(input);
  state.pursuits = setAsidePursuit(state.pursuits, command.pursuitId, command.reason, now);
  return state;
}
export function applyNote(
  input: HubertState,
  command: Extract<CharacterCommand, { type: 'note' }>,
  entryId: string,
  now: number,
): HubertState {
  const state = clone(input);
  const active = activePursuit(state.pursuits);
  if (!active) throw new Error('A note needs an active pursuit.');
  const known = new Set(state.research.offers.map((offer) => offer.sourceId));
  state.pursuits = recordPursuitEntry(
    state.pursuits,
    active.id,
    {
      kind: 'note',
      id: entryId,
      at: now,
      text: command.text,
      surprised: command.surprised,
      sourceIds: (command.sourceIds ?? []).filter((id) => known.has(id)),
    },
    now,
  );
  if (command.next)
    state.pursuits = addPursuitQuestion(state.pursuits, active.id, command.next, now);
  return state;
}

const sameStep = (a: TrailEntry, b: TrailEntry) =>
  a.kind === b.kind &&
  a.why === b.why &&
  a.pursuitId === b.pursuitId &&
  a.text === b.text &&
  a.url === b.url &&
  a.placeId === b.placeId;

/**
 * Appends one step to the trail, keeping the newest entries. A step that repeats the one before
 * it word for word is counted on that entry instead of being listed again.
 */
export function appendTrail(input: HubertState, entry: TrailEntry): HubertState {
  const state = clone(input);
  const last = state.trail.at(-1);
  state.trail =
    last && sameStep(last, entry)
      ? [...state.trail.slice(0, -1), { ...last, at: entry.at, times: (last.times ?? 1) + 1 }]
      : [...state.trail, entry].slice(-TRAIL_KEPT);
  return state;
}

/** Public projection of the pursuits. */
export function publicPursuitList(state: HubertState): PublicPursuit[] {
  return publicPursuits(state.pursuits);
}
