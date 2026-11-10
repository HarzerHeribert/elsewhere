import type { WorldEvent } from '@elsewhere/character-interfaces';

export const routineTypes = new Set([
  'move',
  'arrival',
  'inspect',
  'interact',
  'look',
  'rest',
  'reflect',
  'entity_observed',
]);
export interface ActivityRow {
  event: WorldEvent;
  text: string;
  count: number;
}
/** Group only identical routine receipts; milestones, speech and changed observations stay distinct. */
export function activityRows(events: readonly WorldEvent[]): ActivityRow[] {
  const rows = new Map<string, ActivityRow>();
  for (const event of events) {
    const key = routineTypes.has(event.type)
      ? JSON.stringify([
          event.type,
          event.characterId,
          event.objectId,
          event.entityId,
          event.placeId,
          event.message,
        ])
      : event.id;
    const previous = rows.get(key);
    const text = ['inspect', 'interact'].includes(event.type)
      ? (event.message.match(/^Hubert (?:inspected|spent a moment with) [^.!?]+[.!?]/)?.[0] ??
        event.message)
      : event.message;
    rows.set(key, { event, text, count: (previous?.count ?? 0) + 1 });
  }
  return [...rows.values()].sort((a, b) => b.event.at - a.event.at).slice(0, 20);
}
