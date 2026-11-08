export type {
  Position,
  WorldObject as SceneObject,
  WorldResident as Resident,
  PublicSnapshot as Snapshot,
} from '@elsewhere/character-interfaces';
export function humanize(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
