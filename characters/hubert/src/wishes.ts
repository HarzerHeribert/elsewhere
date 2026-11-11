import type { PublicWish } from '@elsewhere/character-interfaces';
import type { HubertState } from './index';

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

/** At most this many wishes can wait for the owner's answer at once. */
export const WISHES_OPEN = 3;
export const WISHES_KEPT = 24;

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

/** Why a further wish cannot be made now, in words the resident can read; undefined when it can. */
export function wishProblem(state: HubertState): string | undefined {
  const waiting = (state.wishes ?? []).filter(authored).filter((wish) => wish.status === 'pending');
  return waiting.length >= WISHES_OPEN
    ? `You already have ${WISHES_OPEN} wishes that nobody has answered yet. Wait for an answer before wishing again.`
    : undefined;
}

/** Called by the trusted host with a wish the resident wrote with the `wish` command. */
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
