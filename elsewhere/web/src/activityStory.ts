import type { PublicMemory, PublicTrailEntry, WorldEvent } from '@elsewhere/character-interfaces';
import { activityRows, routineTypes, type ActivityRow } from './activityFeed';

export type StoryItem =
  | { kind: 'step'; id: string; at: number; entry: PublicTrailEntry }
  | { kind: 'memory'; id: string; at: number; memory: PublicMemory }
  | { kind: 'made'; id: string; at: number; event: WorldEvent }
  | { kind: 'event'; id: string; at: number; event: WorldEvent };
export type StoryFilter = 'highlights' | 'trail' | 'made' | 'all';
export interface StorySource {
  events: readonly WorldEvent[];
  memories: readonly PublicMemory[];
  trail: readonly PublicTrailEntry[];
  /** The calendar day a world time falls on for the reader. */
  dayOf: (at: number) => number;
}
export interface DayStory {
  day: number;
  /** Everything that is not routine movement, newest first. */
  items: StoryItem[];
  /** Routine receipts (walking, resting, looking), grouped and newest first. */
  routine: ActivityRow[];
  routineCount: number;
}

const madeTypes = new Set(['artifact_created', 'feature_installed']);
/** Steps of the mind: what the resident follows, reads and writes down. */
export const mindKinds: ReadonlySet<string> = new Set([
  'pursue',
  'set_aside',
  'search',
  'read',
  'note',
]);

/** One entry per calendar day that has anything to tell, newest day first. */
export function dayStories(source: StorySource): DayStory[] {
  const days = new Map<number, { items: StoryItem[]; routine: WorldEvent[] }>();
  const bucket = (at: number) => {
    const day = source.dayOf(at);
    let value = days.get(day);
    if (!value) days.set(day, (value = { items: [], routine: [] }));
    return value;
  };
  for (const event of source.events) {
    if (routineTypes.has(event.type)) bucket(event.at).routine.push(event);
    else
      bucket(event.at).items.push({
        kind: madeTypes.has(event.type) ? 'made' : 'event',
        id: 'event:' + event.id,
        at: event.at,
        event,
      });
  }
  for (const entry of source.trail)
    bucket(entry.at).items.push({ kind: 'step', id: 'step:' + entry.id, at: entry.at, entry });
  for (const memory of source.memories)
    bucket(memory.at).items.push({
      kind: 'memory',
      id: 'memory:' + memory.id,
      at: memory.at,
      memory,
    });
  return [...days.entries()]
    .sort(([a], [b]) => b - a)
    .map(([day, value]) => ({
      day,
      items: value.items.sort((a, b) => b.at - a.at),
      routine: activityRows(value.routine),
      routineCount: value.routine.length,
    }));
}

/**
 * Highlights keep a day readable: every milestone and step of the mind, but only its few
 * strongest memories.
 */
export function filterStory(story: DayStory, filter: StoryFilter, memoryLimit = 3): StoryItem[] {
  if (filter === 'trail') return story.items.filter((item) => item.kind === 'step');
  if (filter === 'made') return story.items.filter((item) => item.kind === 'made');
  if (filter === 'all') return story.items;
  const kept = new Set(
    story.items
      .filter((item) => item.kind === 'memory')
      .sort(
        (a, b) =>
          (b.kind === 'memory' ? (b.memory.salience ?? 0) : 0) -
            (a.kind === 'memory' ? (a.memory.salience ?? 0) : 0) || b.at - a.at,
      )
      .slice(0, memoryLimit)
      .map((item) => item.id),
  );
  // Steps in the world are routine; only the steps of the mind belong to the day's highlights.
  return story.items.filter((item) =>
    item.kind === 'memory'
      ? kept.has(item.id)
      : item.kind === 'step'
        ? mindKinds.has(item.entry.kind)
        : true,
  );
}
