import type { CharacterCommand } from '@elsewhere/character-interfaces';

/** Host-owned activity time. Rendering or a visitor's presence never advances completion. */
export function hubertActivityDurationMs(command: CharacterCommand): number {
  switch (command.type) {
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
