import type { Position, WorldState } from '@elsewhere/character-interfaces';
import {
  BODY_RADIUS,
  isWalkable,
  segmentIsWalkable,
} from '@elsewhere/character-interfaces/spatial';

// Must cover the 1.5 s public poll plus normal network jitter. Stale routes still stop.
export const WORLD_PREDICTION_MS = 2200;

/** Render only a short continuation of a path the authoritative server already accepted. */
export function predictApprovedPath(
  position: Position,
  path: Position[],
  elapsedMs: number,
  speed = 0.0032,
  maximumMs = 350,
): Position {
  let current = { ...position };
  let distanceLeft = Math.max(0, Math.min(maximumMs, elapsedMs)) * speed;
  for (const next of path) {
    const distance = Math.hypot(next.x - current.x, next.z - current.z);
    if (distance > distanceLeft) {
      if (distance > 0)
        current = {
          x: current.x + ((next.x - current.x) / distance) * distanceLeft,
          z: current.z + ((next.z - current.z) / distance) * distanceLeft,
        };
      return current;
    }
    current = { ...next };
    distanceLeft -= distance;
  }
  return current;
}

export function walkable(world: WorldState, point: Position, radius = BODY_RADIUS): boolean {
  return isWalkable(world, point, radius);
}

/** WASD is direct locomotion. It must not unexpectedly pathfind around a wall. */
export function directWalkTarget(
  world: WorldState,
  from: Position,
  requested: Position,
  minimumDistance = 0.16,
): Position | null {
  const distance = Math.hypot(requested.x - from.x, requested.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 0.08));
  let last = { ...from };
  for (let i = 1; i <= steps; i++) {
    const point = {
      x: from.x + ((requested.x - from.x) * i) / steps,
      z: from.z + ((requested.z - from.z) * i) / steps,
    };
    if (!segmentIsWalkable(world, last, point)) break;
    last = point;
  }
  return Math.hypot(last.x - from.x, last.z - from.z) > minimumDistance ? last : null;
}

export function clearSegment(world: WorldState, from: Position, to: Position): boolean {
  return segmentIsWalkable(world, from, to);
}

/** Immediate local input, with the same swept collision checks as server movement.
 * Limit visual lead so delayed or rejected commands cannot walk away from authority.
 */
export function stepLocalMovement(
  world: WorldState,
  from: Position,
  authoritative: Position,
  yaw: number,
  forward: number,
  side: number,
  dt: number,
): Position {
  const magnitude = Math.hypot(forward, side);
  if (!magnitude) return from;
  const distance = (3.2 * Math.min(Math.max(dt, 0), 0.05)) / magnitude;
  const requested = {
    x: from.x + (Math.sin(yaw) * forward - Math.cos(yaw) * side) * distance,
    z: from.z + (Math.cos(yaw) * forward + Math.sin(yaw) * side) * distance,
  };
  if (Math.hypot(requested.x - authoritative.x, requested.z - authoritative.z) > 1.25) return from;
  return directWalkTarget(world, from, requested, 0) ?? from;
}
