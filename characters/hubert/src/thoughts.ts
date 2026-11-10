import type { PublicSnapshot, PublicThought } from '@elsewhere/character-interfaces';
import type { PublicExpressionInput } from '../../../packages/adapters/src/models/expression';

export interface HubertThoughtState {
  /** Wall-clock day of the counted requests. */
  day: string;
  calls: number;
  lastAtReal: number;
  /** The public moment the latest request was about; the same moment is never asked twice. */
  lastKey?: string;
  /** Set by the owner; absent means thoughts are shared. */
  disabled?: boolean;
  entries: PublicThought[];
}
export const THOUGHTS_PER_DAY = 24;
export const THOUGHT_INTERVAL_MS = 15 * 60_000;
export const THOUGHTS_KEPT = 48;

/** What a thought may be about: a moment made only of fields every visitor can already see. */
export function thoughtMoment(snapshot: PublicSnapshot, placeId: string | undefined) {
  const place = snapshot.world.places.find((item) => item.id === placeId);
  const research = (snapshot.research ?? []).at(-1);
  const active =
    research && ['searching', 'sources-found', 'reading'].includes(research.status)
      ? research
      : undefined;
  return {
    key: [snapshot.character.activity, place?.id ?? '', active?.id ?? ''].join('|'),
    resting: snapshot.character.status === 'resting',
    place,
    research: active,
  };
}

/** Explicit projection: never pass a HubertState or decision context into public authoring. */
export function thoughtInput(
  snapshot: PublicSnapshot,
  placeId: string | undefined,
): PublicExpressionInput {
  const moment = thoughtMoment(snapshot, placeId);
  const memory = snapshot.memories.at(-1);
  return {
    form: 'thought',
    facts: [
      {
        id: 'now',
        summary:
          `Right now: ${snapshot.character.activity}` +
          (moment.place ? `, at ${moment.place.name}` : '') +
          '.',
      },
      ...(moment.research
        ? [
            {
              id: moment.research.id,
              summary: `Looking into ${moment.research.topic} on the web.`.slice(0, 600),
            },
          ]
        : []),
      ...(memory ? [{ id: memory.id, summary: memory.summary.slice(0, 600) }] : []),
    ],
    interests: snapshot.character.interests
      .slice()
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .map((interest) => interest.name),
    recentNotes: (snapshot.thoughts?.entries ?? []).slice(-2).map((thought) => thought.text),
  };
}
