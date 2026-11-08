import * as THREE from 'three';
import type { WorldState } from '@elsewhere/character-interfaces';
import { WORLD_ASSETS, type AssetInstance, type AttachWorldAsset } from './worldAssets';
import { ResourceScope } from './sceneResources';
import { MEADOW_TRAILS } from './landscapeLayout';

/** Ferns and ground cover grow in natural patches and path verges, not a uniform prop grid. */
export function buildGardens(world: WorldState, scene: THREE.Scene, attach: AttachWorldAsset) {
  const resources = new ResourceScope();
  const root = new THREE.Group();
  root.name = 'Layered photo-scanned garden planting';
  scene.add(root);

  const segmentDistance = (
    x: number,
    z: number,
    a: readonly [number, number],
    b: readonly [number, number],
  ) => {
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      t = THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
  };
  const clear = (x: number, z: number) =>
    x > world.bounds.minX + 0.7 &&
    x < world.bounds.maxX - 0.7 &&
    z > world.bounds.minZ + 0.7 &&
    z < world.bounds.maxZ - 0.7 &&
    !world.obstacles.some(
      (o) => x > o.minX - 0.32 && x < o.maxX + 0.32 && z > o.minZ - 0.32 && z < o.maxZ + 0.32,
    ) &&
    !world.places.some(
      (p) =>
        ['workshop', 'library', 'lookout'].includes(p.id) &&
        x > p.bounds.minX &&
        x < p.bounds.maxX &&
        z > p.bounds.minZ &&
        z < p.bounds.maxZ,
    ) &&
    MEADOW_TRAILS.every(([a, b]) => segmentDistance(x, z, a, b) > 1.2);
  let seed = 18381;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const ferns: AssetInstance[] = [],
    shrubs: AssetInstance[] = [];
  const clusters = [
    [-10, 2, 2.8],
    [-7, 8, 3],
    [-17, 12, 3.2],
    [-24, 17, 3],
    [-14, 21, 2.4],
    [10, 10, 2.3],
    [13, 18, 2.4],
    [26, 11, 2],
    [26, 20, 2.5],
    [9, -10, 2.6],
    [-8, -10, 2.2],
    [-12, -22, 1.8],
  ];
  for (const [cx, cz, radius] of clusters) {
    for (let n = 0; n < 17; n++) {
      const angle = random() * Math.PI * 2,
        r = Math.sqrt(random()) * radius!,
        x = cx! + Math.cos(angle) * r,
        z = cz! + Math.sin(angle) * r;
      if (!clear(x, z)) continue;
      ferns.push({
        x,
        y: 0.035,
        z,
        height: 0.28 + random() * 0.38,
        rotationY: random() * Math.PI * 2,
      });
    }
  }
  // Verge planting stays outside the 1.6m walking surfaces and remains soft underfoot.
  for (const [a, b] of MEADOW_TRAILS) {
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    for (let distance = 1.7; distance < length; distance += 2.5 + random()) {
      const sign = random() > 0.5 ? 1 : -1,
        offset = 1.4 + random() * 0.8,
        t = distance / length,
        x = a[0] + dx * t - (dz / length) * offset * sign,
        z = a[1] + dz * t + (dx / length) * offset * sign;
      if (clear(x, z))
        ferns.push({
          x,
          y: 0.035,
          z,
          height: 0.28 + random() * 0.2,
          rotationY: random() * Math.PI * 2,
        });
    }
  }
  for (const [x, z, height] of [
    [-29, 4, 0.85],
    [-30, 10, 0.75],
    [-27, 21, 0.9],
    [-14, 23, 0.65],
    [27, 20, 0.85],
    [28, 7, 0.8],
    [29, -4, 0.95],
    [8, 23, 0.75],
    [-11, -25, 0.8],
    [29, -23, 0.7],
  ] as const)
    if (clear(x, z)) shrubs.push({ x, y: 0.035, z, height, rotationY: random() * Math.PI * 2 });
  attach.instances(root, WORLD_ASSETS.fern, ferns, { maxDistance: 88, shadow: false });
  attach.instances(root, WORLD_ASSETS.shrub, shrubs, { maxDistance: 100, shadow: true });
  // A real fern fills the existing solid raised bed; its collision footprint does not change.
  const bed = world.objects.find((object) => object.id === 'garden');
  if (bed) {
    const bounds = bed.footprint ?? {
      minX: bed.position.x - 1,
      maxX: bed.position.x + 1,
      minZ: bed.position.z - 1,
      maxZ: bed.position.z + 1,
    };
    attach.instances(
      root,
      WORLD_ASSETS.fern,
      Array.from({ length: 6 }, (_, i) => ({
        x: bounds.minX + 0.2 + ((i % 3) * (bounds.maxX - bounds.minX - 0.4)) / 2,
        y: (bed.elevation ?? 0) + bed.height + 0.03,
        z: bounds.minZ + 0.45 + Math.floor(i / 3) * (bounds.maxZ - bounds.minZ - 0.9),
        height: 0.37,
        rotationY: i * 2.4,
      })),
      { maxDistance: 88, shadow: false },
    );
  }
  const stem = new THREE.CylinderGeometry(0.012, 0.023, 0.75, 5),
    reedMaterial = new THREE.MeshStandardMaterial({ color: 0x7a8050, roughness: 1 }),
    reeds = new THREE.InstancedMesh(stem, reedMaterial, 65),
    matrix = new THREE.Matrix4(),
    quaternion = new THREE.Quaternion();
  for (let i = 0; i < 65; i++) {
    const a = i * 2.4,
      r = 4.1 + (i % 4) * 0.13,
      scale = 0.6 + (i % 5) * 0.13;
    quaternion.setFromEuler(new THREE.Euler(Math.sin(a) * 0.08, a, Math.cos(a) * 0.08));
    matrix.compose(
      new THREE.Vector3(20 + Math.cos(a) * r, 0.1 + (0.75 * scale) / 2, 14 + Math.sin(a) * r),
      quaternion,
      new THREE.Vector3(1, scale, 1),
    );
    reeds.setMatrixAt(i, matrix);
  }
  reeds.instanceMatrix.needsUpdate = true;
  root.add(reeds);
  resources.capture(root);
  return {
    dispose() {
      attach.detach(root);
      root.removeFromParent();
      resources.dispose();
    },
  };
}
