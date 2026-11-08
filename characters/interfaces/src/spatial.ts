import type { Bounds, Obstacle, Position, WorldObject, WorldState } from './index.js';

export const BODY_RADIUS = 0.25;
export const NAVIGATION_GRID = 0.5;
type SpatialWorld = Pick<WorldState, 'bounds' | 'obstacles'>;
type Interval = [number, number];
type SightAperture = Bounds & { minY: number; maxY: number };
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (p: Position, b: Bounds, pad = 0) =>
  p.x >= b.minX + pad && p.x <= b.maxX - pad && p.z >= b.minZ + pad && p.z <= b.maxZ - pad;

function slabInterval(
  start: number,
  delta: number,
  minimum: number,
  maximum: number,
): Interval | null {
  if (Math.abs(delta) < 1e-12) return start >= minimum && start <= maximum ? [0, 1] : null;
  const first = (minimum - start) / delta,
    last = (maximum - start) / delta;
  const enter = Math.max(0, Math.min(first, last)),
    leave = Math.min(1, Math.max(first, last));
  return enter <= leave ? [enter, leave] : null;
}

function rectangleInterval(from: Position, to: Position, bounds: Bounds, pad = 0): Interval | null {
  const x = slabInterval(from.x, to.x - from.x, bounds.minX - pad, bounds.maxX + pad);
  const z = slabInterval(from.z, to.z - from.z, bounds.minZ - pad, bounds.maxZ + pad);
  if (!x || !z) return null;
  const enter = Math.max(x[0], z[0]),
    leave = Math.min(x[1], z[1]);
  return enter <= leave ? [enter, leave] : null;
}

function obstacleInterval(
  from: Position,
  to: Position,
  obstacle: Obstacle,
  pad = 0,
): Interval | null {
  if (obstacle.shape !== 'ellipse') return rectangleInterval(from, to, obstacle, pad);
  const rx = (obstacle.maxX - obstacle.minX) / 2 + pad,
    rz = (obstacle.maxZ - obstacle.minZ) / 2 + pad;
  if (rx <= 0 || rz <= 0) return null;
  const x = (from.x - (obstacle.minX + obstacle.maxX) / 2) / rx,
    z = (from.z - (obstacle.minZ + obstacle.maxZ) / 2) / rz;
  const dx = (to.x - from.x) / rx,
    dz = (to.z - from.z) / rz;
  const a = dx * dx + dz * dz,
    b = 2 * (x * dx + z * dz),
    c = x * x + z * z - 1;
  if (a < 1e-24) return c <= 0 ? [0, 1] : null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant),
    enter = Math.max(0, (-b - root) / (2 * a)),
    leave = Math.min(1, (-b + root) / (2 * a));
  return enter <= leave ? [enter, leave] : null;
}

export function isWalkable(world: SpatialWorld, point: Position, radius = BODY_RADIUS): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.z) &&
    inside(point, world.bounds, radius) &&
    !world.obstacles.some((obstacle) => obstacleInterval(point, point, obstacle, radius))
  );
}

/** Exact continuous collision test, including tiny corner crossings and endpoint connectors. */
export function segmentIsWalkable(
  world: SpatialWorld,
  from: Position,
  to: Position,
  radius = BODY_RADIUS,
): boolean {
  return (
    isWalkable(world, from, radius) &&
    isWalkable(world, to, radius) &&
    !world.obstacles.some((obstacle) => obstacleInterval(from, to, obstacle, radius))
  );
}

/** Grid nodes attach to arbitrary positions only through a verified clear segment. */
export function findWalkPath(
  world: SpatialWorld,
  from: Position,
  to: Position,
  grid = NAVIGATION_GRID,
  radius = BODY_RADIUS,
): Position[] | null {
  if (!isWalkable(world, from, radius) || !isWalkable(world, to, radius)) return null;
  if (distance(from, to) < 1e-9) return [];
  const key = (point: Position) => `${point.x},${point.z}`;
  const attachments = (point: Position) => {
    const x = Math.round(point.x / grid) * grid,
      z = Math.round(point.z / grid) * grid;
    const candidates: Position[] = [];
    for (const dx of [-grid, 0, grid])
      for (const dz of [-grid, 0, grid]) {
        const next = { x: x + dx, z: z + dz };
        if (segmentIsWalkable(world, point, next, radius)) candidates.push(next);
      }
    return candidates.sort((a, b) => distance(point, a) - distance(point, b));
  };
  const starts = attachments(from),
    ends = new Set(attachments(to).map(key));
  if (!starts.length || !ends.size)
    return segmentIsWalkable(world, from, to, radius) ? [{ ...to }] : null;
  const queue = [...starts],
    parents = new Map<string, Position | null>(starts.map((point) => [key(point), null]));
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (ends.has(key(current))) {
      const path: Position[] = [];
      let cursor: Position | null = current;
      while (cursor) {
        path.push(cursor);
        cursor = parents.get(key(cursor)) ?? null;
      }
      path.reverse();
      if (distance(path[0], from) < 1e-9) path.shift();
      if (distance(path.at(-1) ?? from, to) > 1e-9) path.push({ ...to });
      return path;
    }
    for (const [dx, dz] of [
      [grid, 0],
      [-grid, 0],
      [0, grid],
      [0, -grid],
    ]) {
      const next = { x: current.x + dx, z: current.z + dz };
      if (parents.has(key(next)) || !segmentIsWalkable(world, current, next, radius)) continue;
      parents.set(key(next), current);
      queue.push(next);
    }
  }
  return null;
}

/** The wall renderer and authoritative sight share these world-space window openings. */
export function canonicalWallApertures(wall: Obstacle): SightAperture[] {
  const alongX = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
  const length = alongX ? wall.maxX - wall.minX : wall.maxZ - wall.minZ;
  const count = Math.ceil(length / 2.7),
    span = length / count;
  if (span <= 1.5) return [];
  const apertures: SightAperture[] = [];
  for (let index = 0; index < count; index += 2) {
    const center = (alongX ? wall.minX : wall.minZ) + span * (index + 0.5);
    apertures.push({
      minX: alongX ? center - 0.48 : wall.minX,
      maxX: alongX ? center + 0.48 : wall.maxX,
      minZ: alongX ? wall.minZ : center - 0.48,
      maxZ: alongX ? wall.maxZ : center + 0.48,
      minY: 0.95,
      maxY: 2.15,
    });
  }
  return apertures;
}

export function hasLineOfSight(
  world: Pick<WorldState, 'obstacles'>,
  from: Position,
  to: Position,
  targetY = 1.4,
  eyeY = 1.4,
): boolean {
  const dy = targetY - eyeY;
  for (const obstacle of world.obstacles) {
    const horizontal = obstacleInterval(from, to, obstacle),
      vertical = slabInterval(eyeY, dy, 0, obstacle.height);
    if (!horizontal || !vertical) continue;
    const enter = Math.max(horizontal[0], vertical[0], 1e-9),
      leave = Math.min(horizontal[1], vertical[1], 1 - 1e-9);
    if (enter > leave) continue;
    const openings: Interval[] = [];
    for (const aperture of obstacle.sightApertures ?? []) {
      const floor = rectangleInterval(from, to, aperture),
        height = slabInterval(eyeY, dy, aperture.minY, aperture.maxY);
      if (floor && height)
        openings.push([Math.max(floor[0], height[0]), Math.min(floor[1], height[1])]);
    }
    let covered = enter;
    for (const [start, end] of openings.sort((a, b) => a[0] - b[0])) {
      if (start > covered + 1e-9) break;
      covered = Math.max(covered, end);
    }
    if (covered < leave - 1e-9 || !openings.some(([start, end]) => start <= enter && end >= enter))
      return false;
  }
  return true;
}

export function worldObjectObservationHeight(object: WorldObject): number {
  return object.observationHeight ?? Math.max(0.05, (object.elevation ?? 0) + object.height);
}
