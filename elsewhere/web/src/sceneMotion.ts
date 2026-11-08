import type { Position, WorldState } from '@elsewhere/character-interfaces';
import {
  BODY_RADIUS,
  isWalkable,
  segmentIsWalkable,
} from '@elsewhere/character-interfaces/spatial';

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
  return Math.hypot(last.x - from.x, last.z - from.z) > 0.16 ? last : null;
}

export function clearSegment(world: WorldState, from: Position, to: Position): boolean {
  return segmentIsWalkable(world, from, to);
}
