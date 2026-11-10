import * as THREE from 'three';
import type { VillageScenery } from './scenery';
import { WORLD_ASSETS, type AssetInstance, type AttachWorldAsset } from './worldAssets';
import { ResourceScope } from './sceneResources';
import { MEADOW_TRAILS, TRAIL_LINES } from './landscapeLayout';
import { meadowGrass, plantFlora } from './flora';

/** Ferns and ground cover grow in natural patches and path verges, not a uniform prop grid. */
export function buildGardens(world: VillageScenery, scene: THREE.Scene, attach: AttachWorldAsset) {
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
  const poppies: AssetInstance[] = [],
    buttercups: AssetInstance[] = [],
    groundcover: AssetInstance[] = [],
    mushrooms: AssetInstance[] = [];
  const planting = (list: AssetInstance[], x: number, z: number, height: number) =>
    list.push({ x, y: 0.018, z, height, rotationY: random() * Math.PI * 2 });

  // The same continuous curved centreline guides the beds; arclength carries through each sample.
  for (const route of TRAIL_LINES) {
    let along = 0,
      next = 2.9;
    for (let i = 1; i < route.length; i++) {
      const [ax, az] = route[i - 1],
        [bx, bz] = route[i],
        dx = bx - ax,
        dz = bz - az;
      const length = Math.hypot(dx, dz);
      while (next < along + length) {
        const side = random() > 0.5 ? 1 : -1,
          offset = (1.5 + random() * 0.85) * side;
        const fraction = (next - along) / length;
        const x = ax + dx * fraction - (dz / length) * offset,
          z = az + dz * fraction + (dx / length) * offset;
        if (clear(x, z) && Math.hypot(x - 3, z - 3) > 3.1) {
          planting(ferns, x, z, 0.32 + random() * 0.24);
          for (let n = 0; n < 7; n++) {
            const px = x + (random() - 0.5) * 1.3,
              pz = z + (random() - 0.5) * 1.3;
            if (clear(px, pz)) planting(buttercups, px, pz, 0.33 + random() * 0.15);
          }
        }
        next += 2.8 + random() * 2.5;
      }
      along += length;
    }
  }
  // Perennial borders: each planting ribbon has a taller back, broadleaf underplanting and a flowering edge.
  for (const [ax, az, bx, bz, side] of [
    [-8.8, 6.0, -1.7, 6.0, 1],
    [-10.2, -5.5, -10.3, 4.5, -1],
    [-27.7, -9.5, -14.4, -9.4, 1],
    [-11.8, -23.2, -11.7, -19.7, 1],
    [7.3, -6.1, 8.1, -0.7, 1],
    [-27.4, 13.3, -21.1, 9.6, 1],
    [19.0, -23.3, 28.0, -22.8, -1],
    [28.4, -21.9, 28.5, -13.3, 1],
    [24.6, 12.5, 24.1, 17.1, -1],
    [18.1, 18.4, 22.7, 18.8, 1],
    [-24, 22.5, -17.4, 22.8, 1],
  ]) {
    const dx = bx - ax,
      dz = bz - az,
      length = Math.hypot(dx, dz);
    for (let i = 0; i < length * 28; i++) {
      const t = random(),
        lateral =
          (random() - 0.45) * 1.7 * Math.sin(Math.PI * t) ** 0.44 + 0.45 * Math.sin(t * 5.6);
      const x = ax + dx * t - ((side * dz) / length) * lateral,
        z = az + dz * t + ((side * dx) / length) * lateral;
      if (
        world.obstacles.some(
          (o) => x > o.minX - 0.16 && x < o.maxX + 0.16 && z > o.minZ - 0.16 && z < o.maxZ + 0.16,
        ) ||
        MEADOW_TRAILS.some(([a, b]) => segmentDistance(x, z, a, b) < 1.08)
      )
        continue;
      const mix = random();
      if (mix < 0.045) planting(shrubs, x, z, 0.54 + random() * 0.35);
      else if (mix < 0.19) planting(groundcover, x, z, 0.26 + random() * 0.16);
      else if (mix < 0.25) planting(ferns, x, z, 0.42 + random() * 0.19);
      else planting(Math.sin(t * 8 + ax) > 0 ? poppies : buttercups, x, z, 0.37 + random() * 0.28);
    }
  }
  for (const [x, z] of [
    [-23.4, 18.4],
    [-28, 7.2],
    [-16.7, 20.2],
  ])
    planting(mushrooms, x, z, 0.13);
  // Flowers, broadleaf cover and meadow grass are hand-shaped in the world palette and
  // share one breeze. Only the ferns, shrubs and trees remain scans.
  for (const [kind, list] of [
    ['poppy', poppies],
    ['buttercup', buttercups],
    ['groundcover', groundcover],
    ['mushrooms', mushrooms],
  ] as const)
    plantFlora(root, kind, list);
  plantFlora(root, 'tuft', meadowGrass(world));
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
  const stem = new THREE.CylinderGeometry(0.006, 0.012, 0.75, 5),
    reedMaterial = new THREE.MeshStandardMaterial({ color: 0x6d8a45, roughness: 1 }),
    reeds = new THREE.InstancedMesh(stem, reedMaterial, 65),
    matrix = new THREE.Matrix4(),
    quaternion = new THREE.Quaternion();
  for (let i = 0; i < 65; i++) {
    const a = [0.42, 1.8, 3.6, 4.35][i % 4] + (random() - 0.5) * 0.58,
      r = 3.67 + random() * 0.64,
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
