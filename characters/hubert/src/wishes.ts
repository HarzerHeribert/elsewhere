import type { PublicSnapshot, PublicWish } from '@elsewhere/character-interfaces';
import type { PublicWishInput } from '../../../packages/adapters/src/models/expression';
import type { HubertState } from './index';
import { isPublicMemoryEpisode } from './memoryQuality';

export type WishStatus = 'pending' | 'fulfilled' | 'declined';
/**
 * Something the resident said, in their own words, that they would like to exist or be able to
 * do. A wish installs nothing: the owner reads it and decides whether to have it built.
 */
export interface CharacterWish {
  id: string;
  text: string;
  /** Real wall-clock time, like every other time in this module. */
  createdAt: number;
  status: WishStatus;
  fulfilledAt?: number;
  declinedAt?: number;
  receiptId?: string;
}
export interface WishReceipt {
  id: string;
  wishId: string;
  decision: 'fulfill' | 'decline';
  at: number;
}

/** How often the resident is given the chance to wish; saying nothing is an ordinary answer. */
export const WISH_ASK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
/** Quiet time after a wish was made. */
export const WISH_COOLDOWN_MS = 48 * 60 * 60 * 1_000;
/** At most this many wishes in any rolling seven real days. */
export const WISHES_PER_WEEK = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
export const WISHES_OPEN = 3;
export const WISHES_KEPT = 24;
const EXPERIENCES_NEEDED = 3;

const finiteTime = (now: number) => {
  if (!Number.isFinite(now) || now < 0)
    throw new Error('A finite real wall-clock time is required for wishes');
};
/** Saved wishes from before residents wrote their own came from a host catalog; they are dropped. */
const authored = (wish: CharacterWish) => typeof wish.text === 'string' && wish.text.trim() !== '';

/** Backward-compatible with snapshots written before wishes existed or were self-authored. */
function normalize(input: HubertState): HubertState {
  const state = structuredClone(input);
  state.wishes = (state.wishes ?? []).filter(authored);
  const kept = new Set(state.wishes.map((wish) => wish.id));
  state.wishReceipts = (state.wishReceipts ?? []).filter((receipt) => kept.has(receipt.wishId));
  return state;
}

/** Whether the resident may be given the chance to wish now. Reads only; uses real time. */
export function wishDue(state: HubertState, wallNow: number): boolean {
  finiteTime(wallNow);
  const wishes = (state.wishes ?? []).filter(authored);
  if (wishes.filter((wish) => wish.status === 'pending').length >= WISHES_OPEN) return false;
  if (wishes.some((wish) => wallNow - wish.createdAt < WISH_COOLDOWN_MS)) return false;
  if (wishes.filter((wish) => wallNow - wish.createdAt < WEEK_MS).length >= WISHES_PER_WEEK)
    return false;
  if (wallNow - (state.wishesAskedAtReal ?? -Infinity) < WISH_ASK_INTERVAL_MS) return false;
  // A life with nothing behind it yet has had no chance to miss anything. One receipt counts once.
  const lived = new Set(
    state.memories
      .filter(
        (memory) =>
          memory.source === 'world-outcome' &&
          isPublicMemoryEpisode(memory) &&
          (!memory.experience || memory.experience.status === 'completed'),
      )
      .map((memory) => memory.sourceEventId),
  );
  return lived.size >= EXPERIENCES_NEEDED;
}

/** Explicit projection: never pass a HubertState or decision context into public authoring. */
export function wishInput(snapshot: PublicSnapshot): PublicWishInput {
  const note = snapshot.pursuits
    .flatMap((pursuit) => pursuit.entries)
    .filter((entry) => entry.kind === 'note')
    .sort((a, b) => a.at - b.at)
    .at(-1);
  const memory = snapshot.memories.at(-1);
  const names = (items: Array<{ name: string }>) => items.map((item) => item.name).join(', ');
  return {
    form: 'wish',
    facts: [
      {
        id: 'elsewhere',
        summary:
          `Already in Elsewhere. Places: ${names(snapshot.world.places)}. Things: ${names(snapshot.world.objects)}.`.slice(
            0,
            600,
          ),
      },
      ...(note ? [{ id: note.id, summary: note.text.slice(0, 600) }] : []),
      ...(memory ? [{ id: memory.id, summary: memory.summary.slice(0, 600) }] : []),
    ],
    questions: snapshot.pursuits
      .filter((pursuit) => pursuit.status !== 'set-aside')
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 4)
      .map((pursuit) => pursuit.question.slice(0, 80)),
    recentNotes: (snapshot.wishes ?? []).slice(-2).map((wish) => wish.text.slice(0, 360)),
  };
}

/** Called by the trusted host with text the resident authored and the host validated. */
export function recordWish(
  input: HubertState,
  wish: { id: string; text: string },
  wallNow: number,
): HubertState {
  finiteTime(wallNow);
  const text = wish.text.trim();
  if (!text) throw new Error('A wish needs words');
  const state = normalize(input);
  if (state.wishes.some((item) => item.id === wish.id)) return state;
  state.wishes.push({ id: wish.id, text, createdAt: wallNow, status: 'pending' });
  const open = state.wishes.filter((item) => item.status === 'pending');
  const settled = state.wishes.filter((item) => item.status !== 'pending');
  state.wishes = [...open, ...settled.slice(-Math.max(0, WISHES_KEPT - open.length))].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  // No mood reward/punishment: a request is neither a fulfilled promise nor a failed action.
  return state;
}

export interface WishResolution {
  wishId: string;
  decision: 'fulfill' | 'decline';
  receiptId: string;
}

/**
 * Owner-only host operation. Never expose this function as a character/model capability.
 * Fulfilling records the owner's word that the wish was built; it changes nothing in the world.
 */
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
  });
  return state;
}

/** Resetting the simulation erases neither what the resident wished for nor the owner's answers. */
export function preserveWishLedger(fresh: HubertState, previous: HubertState): HubertState {
  const state = structuredClone(fresh);
  const kept = normalize(previous);
  state.wishes = kept.wishes;
  state.wishReceipts = kept.wishReceipts;
  if (previous.wishesAskedAtReal !== undefined)
    state.wishesAskedAtReal = previous.wishesAskedAtReal;
  return state;
}

export function publicWishes(input: HubertState): PublicWish[] {
  return (input.wishes ?? [])
    .filter(authored)
    .map(({ id, text, createdAt, status, fulfilledAt, declinedAt }) => ({
      id,
      text,
      createdAt,
      status,
      fulfilledAt,
      declinedAt,
    }));
}
