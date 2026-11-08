import * as THREE from 'three';
import type { Position, PublicWorldState } from '@elsewhere/character-interfaces';
import { clearSegment } from './sceneMotion';

export function resetActorPlacement(model: THREE.Group) {
  model.userData.placed = false;
  model.userData.approvedRoute = [];
}

/** Initial snapshots are authoritative; subsequent frames follow only clear approved routes. */
export function placeActorModel(
  model: THREE.Group,
  target: Position,
  dt: number,
  world: PublicWorldState | undefined,
  approved: Position[] = [],
) {
  if (!model.userData.placed) {
    model.position.set(target.x, 0, target.z);
    model.userData.placed = true;
    model.userData.approvedRoute = approved;
    return;
  }
  const previous = { x: model.position.x, z: model.position.z };
  const direct = !world || clearSegment(world, previous, target);
  if (direct) {
    model.position.lerp(new THREE.Vector3(target.x, 0, target.z), 1 - Math.exp(-dt * 22));
  } else {
    const prior = (model.userData.approvedRoute ?? []) as Position[];
    const candidates = [...prior, ...approved]
      .sort(
        (a, b) =>
          Math.hypot(a.x - previous.x, a.z - previous.z) -
          Math.hypot(b.x - previous.x, b.z - previous.z),
      )
      .slice(0, 24);
    const waypoint = candidates
      .filter((point) => clearSegment(world, previous, point))
      .sort(
        (a, b) =>
          Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z),
      )[0];
    if (waypoint)
      model.position.lerp(new THREE.Vector3(waypoint.x, 0, waypoint.z), 1 - Math.exp(-dt * 10));
  }
  if (direct) model.userData.approvedRoute = approved;
  const distance = Math.hypot(model.position.x - previous.x, model.position.z - previous.z);
  model.userData.stepPhase = (model.userData.stepPhase ?? 0) + distance * 8;
  const feet = model.userData.feet as THREE.Mesh[] | undefined;
  if (feet)
    for (let i = 0; i < feet.length; i++)
      feet[i]!.rotation.x =
        distance > 0.002
          ? Math.sin(model.userData.stepPhase + i * Math.PI) * 0.35
          : THREE.MathUtils.lerp(feet[i]!.rotation.x, 0, Math.min(1, dt * 15));
}
