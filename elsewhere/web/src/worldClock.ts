import { createContext, useContext } from 'react';
import type { PublicRuntimeState } from '@elsewhere/character-interfaces';

export type WorldClock = Pick<PublicRuntimeState, 'clock' | 'simulationRate'>;

/**
 * The real time of a moment on the world's own clock. That clock stands still while the world
 * is paused, so it falls behind; the world reports where it was lined up with real time again.
 */
export function wallTime(at: number, clock?: WorldClock): number {
  const anchors = clock?.clock;
  if (!anchors?.length) return at;
  let anchor = anchors[0]!;
  for (const next of anchors) {
    if (next.at > at) break;
    anchor = next;
  }
  return Math.round(anchor.wall + (at - anchor.at) / (clock?.simulationRate || 1));
}

const WallTime = createContext<(at: number) => number>((at) => at);
export const WallTimeProvider = WallTime.Provider;
/** Turns a world time from the snapshot into the real time to show. */
export const useWallTime = () => useContext(WallTime);
