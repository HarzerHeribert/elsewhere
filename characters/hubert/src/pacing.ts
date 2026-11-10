import type { CharacterCommand } from '@elsewhere/character-interfaces';

/** Host-owned activity time. Rendering or a visitor's presence never advances completion. */
export function hubertActivityDurationMs(command: CharacterCommand): number {
  switch (command.type) {
    case 'search':
      return 20_000;
    case 'read':
      return 30_000;
    case 'note':
      return 10_000;
    case 'pursue':
    case 'set_aside':
      return 5_000;
    case 'rest':
      return command.durationMs ?? 60_000;
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
