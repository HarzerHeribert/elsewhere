import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { VillageScenery } from './scenery';
import type { createEnvironmentMaterials } from './materials';
import { woodTint } from './craft';

/** The orchard and library share a fieldstone wall; split rail opens the pond side to the valley. */
export function buildMeadowBoundary(
  bounds: VillageScenery['bounds'],
  scene: THREE.Object3D,
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
) {
  const masonry: THREE.Matrix4[] = [],
    joinery: THREE.Matrix4[] = [];
  const transform = new THREE.Object3D();
  const { minX, maxX, minZ, maxZ } = bounds;
  let seed = 43493;
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
  function run(x: number, z: number, endX: number, endZ: number, stone: boolean) {
    const dx = endX - x,
      dz = endZ - z,
      length = Math.hypot(dx, dz),
      angle = -Math.atan2(dz, dx);
    if (length < 0.1) return;
    function block(along: number, y: number, w: number, h: number, d: number, tilt: number) {
      transform.position.set(x + (dx * along) / length, y + h / 2, z + (dz * along) / length);
      transform.rotation.set(0, angle + tilt, 0);
      transform.scale.set(w, h, d);
      transform.updateMatrix();
      (stone ? masonry : joinery).push(transform.matrix.clone());
    }
    if (stone) {
      for (let row = 0; row < 3; row++) {
        let start = 0;
        while (start < length) {
          const span = Math.min(length - start, 0.72 + random() * 0.76);
          if (span > 0.12)
            block(
              start + span / 2,
              row * 0.22 - 0.025,
              span - 0.018,
              0.24 + random() * 0.025,
              0.62 - row * 0.057 + random() * 0.035,
              (random() - 0.5) * 0.055,
            );
          start += span;
        }
      }
    } else {
      const bays = Math.ceil(length / 2.3),
        span = length / bays;
      for (let bay = 0; bay <= bays; bay++) {
        block(bay * span, 0, 0.14, 0.82 + random() * 0.13, 0.16, 0);
        if (bay < bays)
          for (const height of [0.28, 0.62])
            block((bay + 0.5) * span, height, span, 0.108, 0.083, 0);
      }
    }
  }
  run(minX, minZ, minX, maxZ, true);
  run(minX, minZ, maxX, minZ, true);
  run(minX, maxZ, maxX, maxZ, false);
  const gate = THREE.MathUtils.clamp(7, minZ, maxZ);
  run(maxX, minZ, maxX, Math.max(minZ, gate - 1), false);
  run(maxX, Math.min(maxZ, gate + 1), maxX, maxZ, false);
  for (const [matrices, geometry, material] of [
    [
      masonry,
      new RoundedBoxGeometry(1, 1, 1, 1, 0.1),
      surfaces.material('stone', { normalStrength: 0.68 }),
    ],
    [
      joinery,
      new THREE.BoxGeometry(),
      surfaces.material('timber', { normalStrength: 0.5, tint: woodTint('weathered') }),
    ],
  ] as const) {
    const batch = new THREE.InstancedMesh(geometry, material, matrices.length);
    const tint = new THREE.Color();
    matrices.forEach((matrix, i) => {
      batch.setMatrixAt(i, matrix);
      tint.setHSL(0.11 + random() * 0.05, 0.06 + random() * 0.06, 0.74 + random() * 0.23);
      batch.setColorAt(i, tint);
    });
    batch.computeBoundingSphere();
    batch.castShadow = batch.receiveShadow = true;
    scene.add(batch);
  }
}
