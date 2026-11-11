import type { CharacterCommand } from '@elsewhere/character-interfaces';

/** Host-owned activity time. Rendering or a visitor's presence never advances completion. */
export function hubertActivityDurationMs(command: CharacterCommand, energy?: number): number {
  switch (command.type) {
    case 'search':
    case 'use':
      return 20_000;
    case 'read':
      return 30_000;
    case 'note':
      return 10_000;
    case 'pursue':
    case 'set_aside':
      return 5_000;
    case 'rest':
      // Without a chosen duration a rest lasts until energy is comfortably back (about two
      // points a minute), so recovering is one decision instead of a dozen.
      return (
        command.durationMs ??
        Math.min(30 * 60_000, Math.max(60_000, Math.ceil(((70 - (energy ?? 70)) / 2) * 60_000)))
      );
    case 'work':
      return 180_000;
    case 'inspect':
    case 'interact':
      return 60_000;
    case 'reflect':
      return 90_000;
    default:
      // Movement is gated by the authoritative resident path, including slow/blocked travel.
      return 0;
  }
}
