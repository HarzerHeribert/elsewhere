import type { ReflectionInput } from '../../../packages/adapters/src/models/reflection';
import { recentReadings } from '@elsewhere/character-runtime';
import type { HubertState } from './index';

export const PORTRAIT_LIMIT = 1200;
/** A rest has to last this long, in world time, before it is followed by a portrait. */
export const PORTRAIT_REST_MS = 10 * 60_000;
/** The longest a portrait stands before a new one may be written, in world time. */
export const PORTRAIT_INTERVAL_MS = 3 * 60 * 60_000;
export const PORTRAITS_KEPT = 5;

/**
 * Whether a rest that is ending now is followed by a self-portrait. Reads only the state: the
 * rest, the last portrait and whether there is anything to look back on.
 */
export function portraitDue(state: HubertState, now: number): boolean {
  const rest = state.activity;
  if (rest.kind !== 'rest' || now - rest.startedAt < PORTRAIT_REST_MS) return false;
  if (state.portrait && now - state.portrait.at < PORTRAIT_INTERVAL_MS) return false;
  return state.pursuits.items.length > 0;
}

/**
 * What the portrait is written from: the character's own record. Never outside messages,
 * guest notes or private mail.
 */
export function portraitInput(
  state: HubertState,
  identity: string,
  creations: ReadonlyArray<{ title: string; url: string }>,
): ReflectionInput {
  return {
    form: 'portrait',
    identity,
    pursuits: state.pursuits.items.slice(0, 12).map((pursuit) => ({
      question: pursuit.question,
      why: pursuit.why,
      status: pursuit.status,
      ...(pursuit.setAsideReason ? { setAsideReason: pursuit.setAsideReason } : {}),
      notes: pursuit.entries
        .flatMap((entry) => (entry.kind === 'note' ? [entry.text.slice(0, 600)] : []))
        .slice(-4),
    })),
    creations: creations.slice(-32).map(({ title, url }) => ({
      title: title.slice(0, 120),
      url: url.slice(0, 2048),
    })),
    ...(state.portrait ? { previous: state.portrait.text } : {}),
    readings: recentReadings(state.readings, 12).map((reading) => reading.text),
  };
}

/** The new portrait becomes the current one; the one before it moves to the earlier ones. */
export function recordPortrait(input: HubertState, text: string, now: number): HubertState {
  const state = structuredClone(input);
  if (state.portrait) state.portraits = [...state.portraits, state.portrait].slice(-PORTRAITS_KEPT);
  state.portrait = { text: text.slice(0, PORTRAIT_LIMIT), at: now };
  return state;
}
