import * as THREE from 'three';
import type { WorldState } from '@elsewhere/character-interfaces';
import { WORLD_ASSETS, type AssetInstance, type AttachWorldAsset } from './worldAssets';
import { landscapeHeight } from './landscapeLayout';

/** Detailed authored trees reuse GPU geometry/materials, with separate distance-LOD batches. */
export function buildForest(world: WorldState, scene: THREE.Scene, attach: AttachWorldAsset) {
  const root = new THREE.Group();
  root.name = 'Photo-scanned near and middle-distance forest';
  scene.add(root);
  const broadleaf: AssetInstance[] = [],
    fir: AssetInstance[] = [];
  const add = (x: number, z: number, height: number, conifer = false) => {
    (conifer ? fir : broadleaf).push({
      x,
      y: 0.035,
      z,
      height,
      rotationY: ((Math.abs(x * 17 + z * 7) % 31) / 31) * Math.PI * 2,
    });
  };
  // Canonical orchard-tree is rendered separately so it remains an inspectable world object.
  for (const obstacle of world.obstacles) {
    if (!obstacle.id.includes('trunk') || obstacle.id.includes('one')) continue;
    add((obstacle.minX + obstacle.maxX) / 2, (obstacle.minZ + obstacle.maxZ) / 2, 5.7);
  }
  // These are the pre-existing scenic anchors, not new invisible obstacles in walking routes.
  for (const [x, z, height, conifer] of [
    [-29, 5, 7.8, false],
    [-30, 1, 6.7, true],
    [-12, 22, 6.1, false],
    [29, -2, 8.4, true],
    [29, 23, 7.2, false],
    [8, 24, 7.3, false],
    [-30, -25, 8.6, true],
    [30, -24, 8.3, true],
    [-25, 23, 6.2, false],
  ] as const)
    add(x, z, height, conifer);
  // A small ring beyond the playable fence gives the world an organic edge at eye level.
  for (const [x, z, height] of [
    [-39, -19, 9],
    [-39, 16, 8.4],
    [-16, -34, 9.6],
    [20, -34, 10],
    [39, -15, 9.1],
    [39, 19, 8.7],
  ] as const)
    add(x, z, height, true);
  for (const [placements, high, low] of [
    [broadleaf, WORLD_ASSETS.forestTree, WORLD_ASSETS.forestTreeLow],
    [fir, WORLD_ASSETS.treeAlternative, WORLD_ASSETS.treeAlternativeLow],
  ] as const) {
    attach.instances(root, high, placements, { maxDistance: 34, anchorXZ: 'origin' });
    attach.instances(root, low, placements, {
      minDistance: 34,
      maxDistance: 118,
      anchorXZ: 'origin',
      shadow: false,
    });
  }
  const distantBroadleaf: AssetInstance[] = [],
    distantFir: AssetInstance[] = [];
  let seed = 6671;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Uneven woodland groves rather than one tree per evenly spaced angular slot.
  for (let grove = 0; grove < 12; grove++) {
    const centerAngle = (grove / 12) * Math.PI * 2 + (random() - 0.5) * 0.13,
      centerRadius = 77 + random() * 20;
    for (let i = 0; i < 14; i++) {
      const angle = centerAngle + (random() - 0.5) * 0.28,
        radius = THREE.MathUtils.clamp(centerRadius + (random() - 0.5) * 26, 65, 112);
      const placement = {
        x: Math.cos(angle) * radius,
        y: landscapeHeight(radius, angle),
        z: Math.sin(angle) * radius,
        height: 6 + random() * 6,
        rotationY: random() * Math.PI * 2,
      };
      (random() < 0.28 ? distantFir : distantBroadleaf).push(placement);
    }
  }
  attach.instances(root, WORLD_ASSETS.forestTreeLow, distantBroadleaf, {
    maxDistance: 190,
    anchorXZ: 'origin',
    shadow: false,
  });
  attach.instances(root, WORLD_ASSETS.treeAlternativeLow, distantFir, {
    maxDistance: 190,
    anchorXZ: 'origin',
    shadow: false,
  });
  return {
    dispose() {
      attach.detach(root);
      root.removeFromParent();
    },
  };
}
