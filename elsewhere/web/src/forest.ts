import * as THREE from 'three';
import type { VillageScenery } from './scenery';
import { WORLD_ASSETS, type AssetInstance, type AttachWorldAsset } from './worldAssets';
import { landscapeHeight } from './landscapeLayout';
import { addTreeCrowns } from './treeCrowns';
import type { createEnvironmentMaterials } from './materials';
import { ResourceScope } from './sceneResources';

/** Detailed authored trees reuse GPU geometry/materials, with separate distance-LOD batches. */
export function buildForest(
  world: VillageScenery,
  scene: THREE.Scene,
  attach: AttachWorldAsset,
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
) {
  const resources = new ResourceScope();
  const root = new THREE.Group();
  root.name = 'Photo-scanned near and middle-distance forest';
  scene.add(root);
  const broadleaf: AssetInstance[] = [],
    fir: AssetInstance[] = [];
  const add = (x: number, z: number, height: number, conifer = false) => {
    (conifer ? fir : broadleaf).push({
      x,
      y: landscapeHeight(Math.hypot(x, z), Math.atan2(z, x)),
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
    [29, -2, 8.4, false],
    [29, 23, 7.2, false],
    [8, 24, 7.3, false],
    [-30, -25, 8.6, false],
    [30, -24, 8.3, false],
    [-25, 23, 6.2, false],
  ] as const)
    add(x, z, height, conifer);
  // A small ring beyond the playable fence gives the world an organic edge at eye level.
  for (const [x, z, height] of [
    [-37, -10, 10],
    [-39, -19, 9],
    [-39, 16, 8.4],
    [-16, -34, 9.6],
    [20, -34, 10],
    [39, -15, 9.1],
    [39, 19, 8.7],
  ] as const)
    add(x, z, height, x > 38);
  addTreeCrowns(root, broadleaf, surfaces);
  for (const [placements, high, low] of [
    [broadleaf, WORLD_ASSETS.forestTree, WORLD_ASSETS.forestTreeLow],
    [fir, WORLD_ASSETS.treeAlternative, WORLD_ASSETS.treeAlternativeLow],
  ] as const) {
    attach.instances(root, high, placements, { maxDistance: 21, anchorXZ: 'origin' });
    attach.instances(root, low, placements, {
      minDistance: 21,
      anchorXZ: 'origin',
      shadow: true,
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
  for (let grove = 0; grove < 20; grove++) {
    const centerAngle = (grove / 20) * Math.PI * 2 + (random() - 0.5) * 0.13,
      centerRadius = 62 + random() * 34;
    for (let i = 0; i < 20; i++) {
      const angle = centerAngle + (random() - 0.5) * 0.28,
        radius = THREE.MathUtils.clamp(centerRadius + (random() - 0.5) * 24, 53, 112);
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
  // Beyond the playable hills, each silhouette is a local bake of the very same scanned tree.
  // Vertex positions anchor its roots to the terrain. Screen-aligned offsets keep the crowns full from above.
  const positions: number[] = [],
    uvs: number[] = [],
    offsets: number[] = [],
    indices: number[] = [];
  for (const [group, placements] of [distantBroadleaf, distantFir].entries()) {
    for (const tree of placements) {
      const cell = group ? 2 : random() < 0.63 ? 0 : 1;
      const flip = random() < 0.5;
      const i = positions.length / 3;
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        positions.push(tree.x, tree.y, tree.z);
        offsets.push((u - 0.5) * tree.height * 1.62, (v * 1.08 - 0.02) * tree.height);
        uvs.push((cell + (flip ? 1 - u : u)) / 3, v);
      }
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }
  const horizonGeometry = new THREE.BufferGeometry();
  horizonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  horizonGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  horizonGeometry.setAttribute('crownOffset', new THREE.Float32BufferAttribute(offsets, 2));
  horizonGeometry.setIndex(indices);
  horizonGeometry.computeBoundingSphere();
  horizonGeometry.boundingSphere!.radius += 18;
  const map = new THREE.TextureLoader().load('/assets/polyhaven/models/woodland-horizon.webp');
  map.colorSpace = THREE.SRGBColorSpace;
  const horizonMaterial = new THREE.MeshBasicMaterial({
    map,
    alphaTest: 0.32,
    alphaToCoverage: true,
    toneMapped: false,
  });
  horizonMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute vec2 crownOffset;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        'vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0); mvPosition.xy += crownOffset; gl_Position = projectionMatrix * mvPosition;',
      );
  };
  const horizon = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizon.name = 'Wooded hills';
  root.add(horizon);
  resources.capture(root);
  return {
    dispose() {
      attach.detach(root);
      root.removeFromParent();
      resources.dispose();
    },
  };
}
