import { HUBERT_IDENTITY, bodyLanguage } from './persona';
import { hubertDreamActions, hubertDreamSources } from './dreams';
import {
  followThrough,
  settleHubertAttention,
  trackHubertIntent,
  wakeImpulseDecision,
} from './attention';
import { developInterests, seedBirdInterest, type InterestEvidence } from './interests';
import type { CharacterWish, WishReceipt } from './wishes';
export {
  WISH_CATALOG,
  considerWish,
  resolveWish,
  preserveWishLedger,
  publicWishes,
} from './wishes';
export type { CharacterWish, WishReceipt, WishResolution, WishStatus } from './wishes';

import {
  CharacterCommandSchema,
  type CharacterCommand,
  type Observation,
  type PublicCharacterState,
  type PublicMemory,
  type WorldObject,
  type WorldEntity,
  type WorldOutcome,
} from '@elsewhere/character-interfaces';
import {
  buildWorkingContext,
  cleanOutsideText,
  selectAssociativeMemory,
  createDreamState,
  dreamRankingOffsets,
  pruneDreamState,
  wakingDreamImpulses,
  createProgressLedger,
  type DreamState,
  type ProgressLedger,
  type ProgressGuidance,
  type DecisionContext,
  type DecisionProvider,
  type EpisodicMemory,
  type MemoryCue,
  type RecallRecord,
} from '@elsewhere/character-runtime';

export interface HubertStats {
  mood: number;
  energy: number;
  boredom: number;
  frustration: number;
  socialAppetite: number;
}
export interface HubertInterest {
  id: string;
  name: string;
  strength: number;
  encounters: number;
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
  interests: HubertInterest[];
  memories: EpisodicMemory[];
  recallHistory: Record<string, RecallRecord>;
  lastRecallAt: number | null;
  activeRecall: { memoryId: string; at: number } | null;
  knownObjects: Record<string, WorldObject>;
  knownEntities: Record<string, WorldEntity & { lastSeenAt: number }>;
  entityObservations: Record<string, EntityObservationLedger>;
  watchAttention: { lastAt: number | null; times: number[] };
  interestSchemaVersion: 1;
  dormantInterests: HubertInterest[];
  interestEvidence: Record<string, InterestEvidence>;
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
  dreams: DreamState;
  progress: ProgressLedger;
  progressGuidance: ProgressGuidance | null;
  progressDecision: { id: string; intentionKey: string } | null;
  activeWakeImpulse: string | null;
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
    interests: [
      { id: 'birds', name: 'Birdwatching', strength: 0.82, encounters: 0 },
      { id: 'making', name: 'Making small things', strength: 0.55, encounters: 0 },
      { id: 'patterns', name: 'Patterns and little mysteries', strength: 0.4, encounters: 0 },
    ],
    memories: [],
    recallHistory: {},
    lastRecallAt: null,
    activeRecall: null,
    knownObjects: {},
    knownEntities: {},
    entityObservations: {},
    watchAttention: { lastAt: null, times: [] },
    interestSchemaVersion: 1,
    dormantInterests: [],
    interestEvidence: {},
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
  };
}

/** Idempotent migration: a preference is seeded, never a fabricated past bird encounter. */
export function upgradeHubertState(input: HubertState): HubertState {
  const state = clone(input);
  state.knownEntities ??= {};
  state.entityObservations ??= {};
  state.watchAttention ??= { lastAt: null, times: [] };
  state.dormantInterests ??= [];
  state.interestEvidence ??= {};
  state.visitedPlaces ??= {};
  state.dreams ??= createDreamState(state.id);
  state.dreams = pruneDreamState(state.dreams, hubertDreamSources(state));
  state.progress ??= createProgressLedger(state.updatedAt);
  state.progressGuidance ??= null;
  state.progressDecision ??= null;
  state.activeWakeImpulse ??= null;
  seedBirdInterest(state);
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
  const memory = selectAssociativeMemory(state.memories, cues, {
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

function recordIntent(
  state: HubertState,
  action: CharacterCommand,
  explanation: string,
  now: number,
): HubertDecision {
  state.turn += 1;
  trackHubertIntent(state, action, now);
  state.lastDecisionAt = now;
  state.intent = explanation;
  state.activity = {
    kind: action.type,
    label:
      action.type === 'move'
        ? 'Taking a walk'
        : action.type === 'rest'
          ? 'Resting for a while'
          : action.type === 'work'
            ? 'Working on a small experiment'
            : action.type === 'inspect'
              ? 'Looking more closely'
              : action.type === 'reflect'
                ? 'Putting things together'
                : 'Exploring Elsewhere',
    startedAt: now,
    ...('targetId' in action && action.targetId ? { objectId: action.targetId } : {}),
  };
  return { state, action, explanation };
}

function recordWatchIntent(
  state: HubertState,
  entity: WorldEntity,
  explanation: string,
  now: number,
): HubertDecision {
  const decision = recordIntent(state, { type: 'inspect', targetId: entity.id }, explanation, now);
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
export function needsRest(state: HubertState): boolean {
  return state.stats.energy < 24 || (state.activity.kind === 'rest' && state.stats.energy < 68);
}
export function needsLocalFollowThrough(state: HubertState): boolean {
  return state.progressGuidance != null;
}

function canWatch(
  state: HubertState,
  entity: WorldEntity,
  observation: Observation,
  now: number,
): boolean {
  if (
    Math.hypot(
      entity.position.x - observation.position.x,
      entity.position.z - observation.position.z,
    ) > 8
  )
    return false;
  if (state.watchAttention.lastAt !== null && now - state.watchAttention.lastAt < 120_000)
    return false;
  if (state.watchAttention.times.filter((at) => now - at < 900_000).length >= 3) return false;
  const previous = state.entityObservations[entity.id];
  if (!previous) return true;
  const familiar = previous.signatures.includes(entitySignature(entity));
  return (
    entity.observationVersion > previous.lastVersion &&
    now - previous.lastAt >= (familiar ? 6 * 3_600_000 : 180_000)
  );
}
function chooseVisibleEntity(
  state: HubertState,
  observation: Observation,
  now: number,
): WorldEntity | undefined {
  return (observation.visibleEntities ?? [])
    .filter((entity) => canWatch(state, entity, observation, now))
    .slice()
    .sort((a, b) => {
      const score = (entity: WorldEntity) => {
        const speciesKey = (item: WorldEntity) => `${item.kind}:${item.species ?? item.id}`;
        const newSpecies = !Object.values(state.knownEntities).some(
          (known) => speciesKey(known) === speciesKey(entity) && state.entityObservations[known.id],
        );
        const novelBehavior = !state.entityObservations[entity.id]?.signatures.includes(
          entitySignature(entity),
        );
        return (
          (newSpecies ? 4 : 0) +
          (state.entityObservations[entity.id] ? 1 : 3) +
          (novelBehavior ? 2 : 0) +
          (entity.kind === 'bird'
            ? (state.interests.find((interest) => interest.id === 'birds')?.strength ?? 0)
            : 0) -
          Math.hypot(
            entity.position.x - observation.position.x,
            entity.position.z - observation.position.z,
          ) *
            0.05
        );
      };
      return score(b) - score(a) || a.id.localeCompare(b.id);
    })[0];
}

/** A reproducible local planner: no paid provider or credentials are required. */
export function chooseAction(
  input: HubertState,
  observation: Observation,
  now: number,
  nowReal = now,
): HubertDecision {
  const state = advanceHubert(input, now);
  rememberObservation(state, observation, now);
  if (needsRest(state)) {
    return recordIntent(
      state,
      { type: 'rest', durationMs: 60_000 },
      'I will settle down and tuck my feelers in for a while. The unfinished things can wait.',
      now,
    );
  }
  const recovery = followThrough(state, observation, now, {
    recordIntent,
    recordWatchIntent,
    chooseVisibleEntity,
  });
  if (recovery) return recovery;
  const impulse = wakeImpulseDecision(state, observation, now, nowReal, recordIntent);
  if (impulse) return impulse;
  if (state.turn > 0 && state.turn % 11 === 0) {
    return recordIntent(
      state,
      { type: 'reflect' },
      'I want to put a few observations together before starting anything else.',
      now,
    );
  }
  const objects = Object.values(state.knownObjects);
  const projectBench = state.knownObjects.workbench;
  if (
    projectBench &&
    state.inspections.workbench &&
    !state.project.completed &&
    (state.project.verifiedWorkSessions > 0 || state.turn % 4 === 0) &&
    now - (state.lastObjectUse.workbench ?? -Infinity) >= 90_000
  ) {
    const close =
      Math.hypot(
        projectBench.position.x - observation.position.x,
        projectBench.position.z - observation.position.z,
      ) <=
      projectBench.radius + 1;
    return recordIntent(
      state,
      close ? { type: 'work', targetId: 'workbench' } : { type: 'move', targetId: 'workbench' },
      'There are more places to explore, but I would like to follow through on my little weather study first.',
      now,
    );
  }
  const entity = chooseVisibleEntity(state, observation, now);
  if (entity) {
    return recordWatchIntent(
      state,
      entity,
      `I noticed ${entity.name.toLowerCase()} ${entity.behavior}. I want to lean a little closer and watch what it does.`,
      now,
    );
  }
  const uninspected = objects.filter((object) => !state.inspections[object.id]);
  uninspected.sort((a, b) => {
    const aDistance = Math.hypot(
      a.position.x - observation.position.x,
      a.position.z - observation.position.z,
    );
    const bDistance = Math.hypot(
      b.position.x - observation.position.x,
      b.position.z - observation.position.z,
    );
    return aDistance - bDistance || a.id.localeCompare(b.id);
  });
  if (uninspected[0]) {
    const target = uninspected[0];
    const close =
      Math.hypot(
        target.position.x - observation.position.x,
        target.position.z - observation.position.z,
      ) <=
      target.radius + 1;
    return recordIntent(
      state,
      close ? { type: 'inspect', targetId: target.id } : { type: 'move', targetId: target.id },
      `I noticed ${target.name.toLowerCase()}. I would like to see what it is like up close.`,
      now,
    );
  }
  // Public map landmarks are navigation knowledge, not knowledge of their hidden contents.
  // Occasionally leave familiar activities long enough to discover a new part of Elsewhere.
  const landmarks = observation.knownPlaces ?? [];
  const unexplored = landmarks.filter(
    (place) => place.id !== observation.placeId && state.visitedPlaces[place.id] === undefined,
  );
  const returning = landmarks
    .filter((place) => place.id !== observation.placeId)
    .slice()
    .sort(
      (a, b) =>
        (state.visitedPlaces[a.id] ?? -Infinity) - (state.visitedPlaces[b.id] ?? -Infinity) ||
        a.id.localeCompare(b.id),
    );
  const nextPlace =
    state.turn % 7 === 0
      ? unexplored[0]
      : state.turn % 17 === 0 && !unexplored.length
        ? returning[0]
        : undefined;
  if (nextPlace) {
    state.explorationStep += 1;
    return recordIntent(
      state,
      { type: 'move', targetId: nextPlace.id },
      unexplored.includes(nextPlace)
        ? `The public map shows ${nextPlace.name.toLowerCase()}. I would like to go and find out what is there.`
        : `I have not been back to ${nextPlace.name.toLowerCase()} for a while. I wonder what I will notice this time.`,
      now,
    );
  }
  const useful = objects.filter(
    (object) =>
      (object.id !== 'bench' || state.stats.energy < 58) &&
      object.affordances.some((value) => ['work', 'interact', 'tend', 'sit'].includes(value)) &&
      now - (state.lastObjectUse[object.id] ?? -Infinity) >= 90_000,
  );
  useful.sort(
    (a, b) =>
      (state.interactions[a.id] ?? 0) - (state.interactions[b.id] ?? 0) || a.id.localeCompare(b.id),
  );
  if (useful[0]) {
    const target = useful[0];
    const close =
      Math.hypot(
        target.position.x - observation.position.x,
        target.position.z - observation.position.z,
      ) <=
      target.radius + 1;
    const command: CharacterCommand = close
      ? target.affordances.includes('work')
        ? { type: 'work', targetId: target.id }
        : target.id === 'bench'
          ? { type: 'rest', durationMs: 30_000 }
          : { type: 'interact', targetId: target.id }
      : { type: 'move', targetId: target.id };
    return recordIntent(
      state,
      command,
      target.affordances.includes('work')
        ? 'I have a few observations. I want to try making something from them.'
        : `I feel like spending a little time with ${target.name.toLowerCase()}.`,
      now,
    );
  }
  // The walk is a route through public space, not knowledge of unseen objects or private interiors.
  const walks = [
    { x: 1, z: 0 },
    { x: -3, z: 0 },
    { x: -6, z: -1 },
    { x: -6, z: 2 },
    { x: 1, z: -3 },
    { x: 5, z: -2 },
    { x: 5, z: 4 },
  ];
  const destination = walks[state.explorationStep % walks.length];
  state.explorationStep += 1;
  return recordIntent(
    state,
    { type: 'move', position: destination },
    'I have been in one spot for a while. I will take a walk and see what catches my attention.',
    now,
  );
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
  const actualTopics = new Set(visible.tags);
  if (visible.kind === 'bird') actualTopics.add('birds');
  const topics = encounter.topics.filter((topic) => actualTopics.has(topic));
  if (!familiar) developInterests(state, topics, `entity:${visible.id}`, signature, now);
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
  state.memories.push({
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
  settleHubertAttention(state, outcome, now, nowReal);
  if (outcome.status === 'started') return state;
  const targetId =
    outcome.objectId ?? ('targetId' in outcome.command ? outcome.command.targetId : undefined);
  const target = targetId ? state.knownObjects[targetId] : undefined;
  if (outcome.status === 'rejected') {
    state.stats.frustration += 1;
    state.intent = 'That did not work. I will reconsider rather than pretend it succeeded.';
    if (targetId) state.lastObjectUse[targetId] = now;
    state.stats = normalizeStats(state.stats);
    state.memories.push({
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
      salience: 0.55,
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
    developInterests(
      state,
      target?.tags ?? [],
      `object:${targetId}`,
      `inspection:${targetId}`,
      now,
    );
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
      developInterests(
        state,
        target?.tags ?? ['making'],
        `project:${state.project.id}`,
        `milestone:${state.project.verifiedWorkSessions}`,
        now,
        90_000,
      );
    }
  }
  if (outcome.command.type === 'reflect') {
    state.stats.frustration -= 2;
    state.lastReflection = state.memories.length
      ? `I keep returning to ${
          state.interests
            .slice()
            .sort((a, b) => b.strength - a.strength)[0]
            ?.name.toLowerCase() ?? 'small discoveries'
        }. I would like to see where that leads.`
      : 'I am still getting to know this place. I do not need to decide what I like yet.';
  }
  state.stats = normalizeStats(state.stats);
  const shouldRemember = ['inspect', 'work', 'interact'].includes(outcome.command.type);
  if (shouldRemember) {
    const cues: MemoryCue[] = [{ kind: 'place', value: outcome.placeId ?? observation.placeId }];
    if (targetId) cues.push({ kind: 'object', value: targetId });
    state.memories.push({
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
  if (shouldRemember || outcome.command.type === 'reflect') {
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
    interests: state.interests.map(({ id, name, strength, encounters }) => ({
      id,
      name,
      strength,
      encounters,
    })),
    currentThought: state.intent,
    ...(state.lastReflection ? { lastReflection: state.lastReflection } : {}),
  };
}
const toPublicMemory = (memory: EpisodicMemory): PublicMemory => ({
  id: memory.id,
  at: memory.createdAt,
  summary: memory.summary,
  cues: memory.cues.map((cue) => `${cue.kind}:${cue.value}`),
  placeId: memory.cues.find((cue) => cue.kind === 'place')?.value,
  objectId: memory.cues.find((cue) => cue.kind === 'object')?.value,
  entityId: memory.cues.find((cue) => cue.kind === 'entity')?.value,
  moodAtEncoding: memory.emotionalContext.mood,
  salience: memory.salience,
});
export function publicMemories(state: HubertState): PublicMemory[] {
  return state.memories
    .filter((memory) => memory.verified && memory.source === 'world-outcome')
    .slice(-12)
    .map(toPublicMemory);
}
export function recalledMemory(state: HubertState, now: number): PublicMemory | null {
  if (!state.activeRecall || now - state.activeRecall.at > 90_000) return null;
  const memory = state.memories.find(
    (item) =>
      item.id === state.activeRecall?.memoryId && item.verified && item.source === 'world-outcome',
  );
  return memory ? toPublicMemory(memory) : null;
}
/** A compact planning view; original episodes, memories and cue records stay in character state. */
function planningSummary(state: HubertState, observation: Observation, nowReal: number) {
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
    interests: state.interests.map((interest) => ({ ...interest })),
    project: { ...state.project },
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

export function workingContext(
  state: HubertState,
  observation: Observation,
  nowReal = observation.observedAt,
): DecisionContext {
  return buildWorkingContext({
    identity: HUBERT_IDENTITY,
    state: planningSummary(state, observation, nowReal),
    intentions: [state.intent, state.project.name],
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
  });
}

/** Models can propose schema-valid actions; the host must still authorize them before execution. */
export async function chooseActionWithProvider(
  input: HubertState,
  observation: Observation,
  now: number,
  provider: DecisionProvider,
  nowReal = now,
): Promise<HubertDecision> {
  const state = advanceHubert(input, now);
  rememberObservation(state, observation, now);
  if (needsRest(state) || needsLocalFollowThrough(state))
    return chooseAction(input, observation, now, nowReal);
  const result = await provider.propose(workingContext(state, observation, nowReal));
  const action = CharacterCommandSchema.parse(result);
  if (
    action.type === 'move' &&
    action.targetId &&
    !observation.visibleEntities?.some((entity) => entity.id === action.targetId) &&
    !state.knownObjects[action.targetId] &&
    !observation.knownPlaces?.some((place) => place.id === action.targetId)
  )
    return chooseAction(input, observation, now, nowReal);
  if ('targetId' in action && action.targetId && state.knownEntities[action.targetId]) {
    const current = observation.visibleEntities?.find((entity) => entity.id === action.targetId);
    if (!current || (action.type === 'inspect' && !canWatch(state, current, observation, now)))
      return chooseAction(input, observation, now, nowReal);
  }
  if (
    'targetId' in action &&
    action.targetId &&
    ['work', 'interact'].includes(action.type) &&
    now - (state.lastObjectUse[action.targetId] ?? -Infinity) < 90_000
  )
    return chooseAction(input, observation, now, nowReal);
  const explanation = 'I have chosen a next step from what I can currently observe.';
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
    return recordWatchIntent(state, entity, explanation, now);
  }
  return recordIntent(state, action, explanation, now);
}
