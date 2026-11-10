import type {
  PublicMemory,
  PublicNotebookEntry,
  PublicResearchEpisode,
  PublicThought,
  WorldEvent,
} from '@elsewhere/character-interfaces';
import { activityRows, routineTypes, type ActivityRow } from './activityFeed';

export type StoryItem =
  | { kind: 'research'; id: string; at: number; episode: PublicResearchEpisode }
  | { kind: 'note'; id: string; at: number; entry: PublicNotebookEntry }
  | { kind: 'thought'; id: string; at: number; thought: PublicThought }
  | { kind: 'memory'; id: string; at: number; memory: PublicMemory }
  | { kind: 'made'; id: string; at: number; event: WorldEvent }
  | { kind: 'event'; id: string; at: number; event: WorldEvent };
export type StoryFilter = 'highlights' | 'thoughts' | 'research' | 'made' | 'notes' | 'all';
export interface StorySource {
  events: readonly WorldEvent[];
  memories: readonly PublicMemory[];
  notes: readonly PublicNotebookEntry[];
  research: readonly PublicResearchEpisode[];
  thoughts?: readonly PublicThought[];
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
export const researchInProgress = (episode?: PublicResearchEpisode) =>
  episode?.status === 'searching' || episode?.status === 'reading';

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
  for (const episode of source.research)
    bucket(episode.at).items.push({
      kind: 'research',
      id: 'research:' + episode.id,
      at: episode.at,
      episode,
    });
  for (const entry of source.notes)
    bucket(entry.at).items.push({ kind: 'note', id: 'note:' + entry.id, at: entry.at, entry });
  for (const thought of source.thoughts ?? [])
    bucket(thought.at).items.push({
      kind: 'thought',
      id: 'thought:' + thought.id,
      at: thought.at,
      thought,
    });
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

/** A thought is current for a while after it was shared, then it is only part of the day. */
export const THOUGHT_FRESH_MS = 30 * 60_000;
export const currentThought = (thoughts: readonly PublicThought[] | undefined, now: number) => {
  const latest = thoughts?.at(-1);
  return latest && now - latest.at < THOUGHT_FRESH_MS && now >= latest.at - 60_000
    ? latest
    : undefined;
};

/**
 * Highlights keep a day readable: every milestone, but only its few strongest memories and its
 * most recent thoughts.
 */
export function filterStory(story: DayStory, filter: StoryFilter, memoryLimit = 3): StoryItem[] {
  if (filter === 'thoughts') return story.items.filter((item) => item.kind === 'thought');
  if (filter === 'research') return story.items.filter((item) => item.kind === 'research');
  if (filter === 'made') return story.items.filter((item) => item.kind === 'made');
  if (filter === 'notes') return story.items.filter((item) => item.kind === 'note');
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
  // Items are newest first, so the leading thoughts are the latest ones.
  for (const item of story.items.filter((entry) => entry.kind === 'thought').slice(0, memoryLimit))
    kept.add(item.id);
  return story.items.filter(
    (item) => (item.kind !== 'memory' && item.kind !== 'thought') || kept.has(item.id),
  );
}
