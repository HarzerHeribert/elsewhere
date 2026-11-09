import type { PublicNotebookEntry, PublicSnapshot } from '@elsewhere/character-interfaces';
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
