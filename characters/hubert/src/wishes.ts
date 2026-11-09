import type { Observation, PublicWish, WorldState } from '@elsewhere/character-interfaces';
import type { HubertState } from './index';
import { isPublicMemoryEpisode } from './memoryQuality';

export type WishStatus = 'pending' | 'fulfilled' | 'declined';
export interface CharacterWish {
  id: string;
  title: string;
  description: string;
  reason: string;
  createdAt: number;
  status: WishStatus;
  requestedObjectId: string;
  sourceMemoryIds: string[];
  requestedAtWorldVersion: number;
  baselineObjectIds: string[];
  fulfilledAt?: number;
  declinedAt?: number;
  receiptId?: string;
}
export interface WishReceipt {
  id: string;
  wishId: string;
  decision: 'fulfill' | 'decline';
  at: number;
  worldVersion: number;
  objectId?: string;
}
export interface WishCatalogEntry {
  id: string;
  title: string;
  description: string;
  reason: string;
  interests: readonly string[];
}

/** Owner-installable possibilities, never promises or instructions to spend money. */
export const WISH_CATALOG: readonly WishCatalogEntry[] = [
  {
    id: 'weather-station',
    title: 'A little weather station',
    description:
      'It might be interesting to leave an instrument running and compare its readings later.',
    reason: 'I would like to compare weather readings with the sketch I worked on.',
    interests: ['weather', 'patterns', 'making'],
  },
  {
    id: 'magnifying-glass',
    title: 'A magnifying glass',
    description: 'I would like a closer look at the details of a small mechanism.',
    reason: 'A closer look might reveal details I have not noticed yet.',
    interests: ['mechanism', 'unfamiliar', 'making'],
  },
  {
    id: 'painting-kit',
    title: 'Some painting materials',
    description: 'Perhaps I could try recording something in colour.',
    reason: 'Making something slowly, with room for mistakes, seems worth trying.',
    interests: ['making', 'light', 'color', 'colour', 'projects'],
  },
  {
    id: 'telescope',
    title: 'A small telescope',
    description: 'I wonder what I might notice if I could look farther from the courtyard.',
    reason: 'There seem to be patterns here that reward a longer look.',
    interests: ['patterns', 'light', 'quiet', 'sky'],
  },
  {
    id: 'seed-library',
    title: 'A few unfamiliar seeds',
    description:
      'I would like to see how a small collection of different plants changes over time.',
    reason: 'I wonder how unfamiliar seeds would grow here.',
    interests: ['nature', 'patterns', 'courtyard'],
  },
  {
    id: 'music-box',
    title: 'Something that makes music',
    description: 'I am curious whether a quiet corner would feel different with a little music.',
    reason: 'A small tune might be worth listening to here.',
    interests: ['sound', 'music', 'quiet', 'rest'],
  },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const COOLDOWN_MS = 48 * 60 * 60 * 1_000;
const finiteTime = (now: number) => {
  if (!Number.isFinite(now) || now < 0)
    throw new Error('A finite real wall-clock time is required for wishes');
};

/** Backward-compatible with saved schema-v1 snapshots written before wishes existed. */
function normalize(input: HubertState): HubertState {
  const state = structuredClone(input);
  state.wishes ??= [];
  state.wishReceipts ??= [];
  return state;
}

/** A broad taste alone cannot manufacture the experience described by a particular wish. */
function supportsWish(
  state: HubertState,
  candidate: WishCatalogEntry,
  memory: HubertState['memories'][number],
): boolean {
  const experience = memory.experience;
  if (!experience || experience.status !== 'completed') return false;
  const work = experience.action === 'work' && experience.targetId === 'workbench';
  if (candidate.id === 'weather-station') return state.project.verifiedWorkSessions > 0 && work;
  const ids = new Set([
    ...(experience.targetId ? [experience.targetId] : []),
    ...memory.cues
      .filter((cue) => cue.kind === 'object' || cue.kind === 'entity')
      .map((cue) => cue.value),
  ]);
  const targets = [...ids].flatMap((id) => state.knownObjects[id] ?? state.knownEntities[id] ?? []);
  const tagged = (...tags: string[]) =>
    targets.some((target) => target.tags.some((tag) => tags.includes(tag)));
  if (candidate.id === 'magnifying-glass') return tagged('mechanism');
  if (candidate.id === 'painting-kit') return work || tagged('making', 'light', 'color', 'colour');
  if (candidate.id === 'telescope')
    return tagged('sky') || targets.some((target) => ['window', 'telescope'].includes(target.kind));
  if (candidate.id === 'seed-library')
    return targets.some((target) => ['garden', 'tree', 'plant', 'seed'].includes(target.kind));
  if (candidate.id === 'music-box') return tagged('sound', 'music');
  return false;
}

/**
 * Called by the trusted host using REAL wall-clock time, never simulated world time.
 * Wishes express possibilities. They neither install objects nor change budgets or permissions.
 */
export function considerWish(
  input: HubertState,
  observation: Observation,
  wallNow: number,
  world: WorldState,
): HubertState {
  finiteTime(wallNow);
  if (observation.characterId !== input.id)
    throw new Error('Wish observation belongs to another character');
  const state = normalize(input);
  const seenSources = new Set<string>();
  const evidence = state.memories.filter((memory) => {
    const source = JSON.stringify([memory.source, memory.sourceEventId]);
    if (seenSources.has(source)) return false;
    seenSources.add(source);
    return (
      memory.source === 'world-outcome' &&
      isPublicMemoryEpisode(memory) &&
      (!memory.experience || memory.experience.status === 'completed')
    );
  });
  if (evidence.length < 3) return state;
  if (state.wishes.filter((wish) => wish.status === 'pending').length >= 3) return state;
  if (state.wishes.filter((wish) => wallNow - wish.createdAt < WEEK_MS).length >= 3) return state;
  const latest = state.wishes.reduce((max, wish) => Math.max(max, wish.createdAt), -Infinity);
  if (wallNow - latest < COOLDOWN_MS) return state;
  const available = new Set(world.objects.map((object) => object.id));
  const alreadyAsked = new Set(state.wishes.map((wish) => wish.requestedObjectId));
  const ranked = WISH_CATALOG.filter(
    (candidate) => !available.has(candidate.id) && !alreadyAsked.has(candidate.id),
  )
    .flatMap((candidate) => {
      const interests = state.interests.filter(
        (interest) =>
          candidate.interests.includes(interest.id) &&
          Number.isFinite(interest.strength) &&
          interest.strength > 0,
      );
      if (!interests.length) return [];
      const relevant = evidence.filter((memory) => supportsWish(state, candidate, memory));
      if (!relevant.length) return [];
      return [
        {
          candidate,
          relevant,
          score: Math.max(...interests.map((interest) => interest.strength)),
          latestAt: Math.max(...relevant.map((memory) => memory.createdAt)),
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.latestAt - a.latestAt ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
  const selected = ranked[0];
  if (!selected) return state;
  const { candidate, relevant } = selected;
  const sources = relevant.slice(-3).map((memory) => memory.id);
  state.wishes.push({
    id: `wish:${state.id}:${wallNow}:${candidate.id}`,
    title: candidate.title.slice(0, 100),
    description: candidate.description.slice(0, 300),
    reason: candidate.reason.slice(0, 300),
    createdAt: wallNow,
    status: 'pending',
    requestedObjectId: candidate.id,
    sourceMemoryIds: sources,
    requestedAtWorldVersion: world.version,
    baselineObjectIds: [...available],
  });
  // No mood reward/punishment: a request is neither a fulfilled promise nor a failed action.
  return state;
}

export interface WishResolution {
  wishId: string;
  decision: 'fulfill' | 'decline';
  receiptId: string;
  world: WorldState;
}

/** Owner-only host operation. Never expose this function as a character/model capability. */
export function resolveWish(
  input: HubertState,
  resolution: WishResolution,
  wallNow: number,
): HubertState {
  finiteTime(wallNow);
  if (!['fulfill', 'decline'].includes(resolution.decision))
    throw new Error('Unknown wish decision');
  if (!resolution.receiptId.trim() || resolution.receiptId.length > 200)
    throw new Error('A bounded owner receipt ID is required');
  const state = normalize(input);
  const prior = state.wishReceipts.find((receipt) => receipt.id === resolution.receiptId);
  if (prior) {
    if (prior.wishId !== resolution.wishId || prior.decision !== resolution.decision)
      throw new Error('Receipt was already used for a different wish operation');
    return state;
  }
  const wish = state.wishes.find((item) => item.id === resolution.wishId);
  if (!wish) throw new Error('Unknown wish');
  if (wish.status !== 'pending') throw new Error('This wish has already been resolved');
  if (wallNow < wish.createdAt) throw new Error('A wish cannot be resolved before it was created');
  if (resolution.decision === 'fulfill') {
    if (
      resolution.world.id !== 'elsewhere' ||
      !resolution.world.residents.some(
        (resident) => resident.id === state.id && resident.ownerId === state.ownerId,
      )
    )
      throw new Error('Fulfillment world does not belong to this resident');
    if (resolution.world.version <= wish.requestedAtWorldVersion)
      throw new Error('Fulfillment requires a newer world update');
    if (wish.baselineObjectIds.includes(wish.requestedObjectId))
      throw new Error('The requested object was already present when this wish was made');
    if (!resolution.world.objects.some((object) => object.id === wish.requestedObjectId))
      throw new Error('The requested object has not actually been added to Elsewhere');
    wish.status = 'fulfilled';
    wish.fulfilledAt = wallNow;
  } else {
    wish.status = 'declined';
    wish.declinedAt = wallNow;
  }
  wish.receiptId = resolution.receiptId;
  state.wishReceipts.push({
    id: resolution.receiptId,
    wishId: wish.id,
    decision: resolution.decision,
    at: wallNow,
    worldVersion: resolution.world.version,
    ...(resolution.decision === 'fulfill' ? { objectId: wish.requestedObjectId } : {}),
  });
  return state;
}

/** Resetting the simulation cannot replenish the real-life request allowance or erase owner receipts. */
export function preserveWishLedger(fresh: HubertState, previous: HubertState): HubertState {
  const state = normalize(fresh);
  state.wishes = structuredClone(previous.wishes ?? []);
  state.wishReceipts = structuredClone(previous.wishReceipts ?? []);
  return state;
}

export function publicWishes(input: HubertState): PublicWish[] {
  return (input.wishes ?? []).map(
    ({
      id,
      title,
      description,
      reason,
      createdAt,
      status,
      requestedObjectId,
      fulfilledAt,
      declinedAt,
      receiptId,
    }) => ({
      id,
      title,
      description,
      reason,
      createdAt,
      status,
      requestedObjectId,
      fulfilledAt,
      declinedAt,
      receiptId,
    }),
  );
}
