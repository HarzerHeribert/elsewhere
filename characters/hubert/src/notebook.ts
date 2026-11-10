import type {
  PublicNoteTopic,
  PublicNotebookEntry,
  PublicSnapshot,
} from '@elsewhere/character-interfaces';
import type { PublicExpressionInput } from '../../../packages/adapters/src/models/expression';
export interface HubertNotebookState {
  day: string;
  calls: number;
  latestAtReal: number;
  lastAtReal: number;
  sourceIds: string[];
  failedSourceId?: string;
  pending?: { id: string; sourceId: string };
  entries: PublicNotebookEntry[];
}
/** Topics come from the supplied facts themselves, so a note is never labelled by guesswork. */
export function notebookTopics(
  snapshot: PublicSnapshot,
  facts: PublicExpressionInput['facts'],
): PublicNoteTopic[] {
  const topics = new Map<string, PublicNoteTopic>();
  const add = (topic: PublicNoteTopic) => topics.set(topic.kind + ':' + topic.id, topic);
  for (const fact of facts) {
    const memory = snapshot.memories.find((item) => item.id === fact.id);
    const event = memory ? undefined : snapshot.events.find((item) => item.id === fact.id);
    const place = snapshot.world.places.find(
      (item) => item.id === (memory?.placeId ?? event?.placeId),
    );
    if (place) add({ kind: 'place', id: place.id, label: place.name });
    if (memory?.sourceUrl)
      add({
        kind: 'reading',
        id: memory.sourceUrl,
        label: (memory.sourceTitle || new URL(memory.sourceUrl).hostname).slice(0, 80),
      });
    if (event?.type === 'interest_changed')
      add({ kind: 'interest', id: event.id, label: 'A change of interest' });
  }
  return [...topics.values()].slice(0, 4);
}
/** Explicit projection: never pass a HubertState or decision context into public authoring. */
export function notebookInput(snapshot: PublicSnapshot): PublicExpressionInput {
  const preference = snapshot.events
    .slice()
    .reverse()
    .find(
      (event) =>
        event.type === 'interest_changed' && snapshot.runtime.simulatedAt - event.at < 20 * 60000,
    );
  return {
    facts: [
      ...snapshot.memories
        .slice(preference ? -2 : -3)
        .map((m) => ({ id: m.id, summary: m.summary.slice(0, 600) })),
      ...(preference ? [{ id: preference.id, summary: preference.message.slice(0, 600) }] : []),
    ],
    interests: snapshot.character.interests
      .slice()
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .map((i) => i.name),
    recentNotes: (snapshot.notebook?.entries ?? []).slice(-2).map((n) => n.text),
  };
}
