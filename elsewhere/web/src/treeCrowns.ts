import * as THREE from 'three';
import type { AssetInstance } from './worldAssets';
import type { createEnvironmentMaterials } from './materials';

// Centres of foliage clusters on the two shipped Poly Haven meshes, normalized by tree height.
// Keeping the scan's asymmetric growth puts leaves over its forks and leaves the trunk visible.
const broadleaf = [
  [0.052, 0.419, -0.178],
  [-0.113, 0.732, 0.252],
  [-0.05, 0.763, 0.333],
  [0.037, 0.744, -0.151],
  [0.165, 0.825, -0.116],
  [-0.097, 0.781, 0.042],
  [0.164, 0.892, 0.363],
  [-0.007, 0.692, 0.512],
  [0.138, 0.903, 0.094],
  [-0.094, 0.8, -0.047],
  [0.008, 0.859, 0.487],
  [-0.064, 0.895, 0.226],
  [-0.071, 0.923, -0.009],
  [0.174, 0.626, 0.023],
  [-0.166, 0.636, 0.061],
  [0.196, 0.525, -0.098],
  [0.134, 0.672, 0.147],
  [0.291, 0.602, -0.137],
  [0.25, 0.732, -0.153],
  [0.031, 0.835, -0.044],
  [-0.015, 0.889, 0.05],
  [0.099, 0.557, -0.236],
  [0.18, 0.655, 0.291],
  [0.042, 0.93, 0.184],
];
const apple = [
  [-0.152, 0.583, 0.154],
  [-0.128, 0.521, 0.401],
  [-0.414, 0.666, 0.47],
  [-0.062, 0.536, 0.538],
  [-0.111, 0.686, 0.707],
  [0.062, 0.526, 0.053],
  [-0.196, 0.773, 0.05],
  [0.05, 0.646, 0.366],
  [-0.097, 0.686, 0.416],
  [-0.316, 0.553, 0.375],
  [0.012, 0.724, 0.032],
  [0.229, 0.598, -0.09],
  [0.282, 0.79, 0.671],
  [-0.491, 0.702, 0.666],
  [0.28, 0.651, 0.253],
  [-0.206, 0.676, 0.525],
  [0.173, 0.697, 0.516],
  [-0.451, 0.549, 0.619],
  [-0.197, 0.574, -0.123],
  [-0.393, 0.627, 0.636],
  [0.441, 0.698, 0.45],
  [0.058, 0.708, -0.192],
  [-0.476, 0.673, 0.172],
  [-0.275, 0.875, -0.178],
];

export function addTreeCrowns(
  root: THREE.Object3D,
  trees: AssetInstance[],
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
  orchard = false,
) {
  if (!trees.length) return;
  let seed = 937;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    colors: number[] = [];
  const color = new THREE.Color();
  // A spray of individually curved leaves. All sprays share one small indexed geometry.
  for (let i = 0; i < 200; i++) {
    const angle = random() * Math.PI * 2,
      radius = Math.sqrt(random()),
      y = (random() - 0.5) * Math.sqrt(1 - radius * radius);
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius,
      yaw = angle + (random() - 0.5) * 2.7;
    const width = 0.12 + random() * 0.1,
      length = width * (1.8 + random() * 0.4),
      droop = 0.1 + random() * 0.21;
    const c = Math.cos(yaw),
      s = Math.sin(yaw),
      index = positions.length / 3;
    // The leafy end points outwards and downwards, the attachment is under the crown.
    const left = 0.008,
      right = 0.169,
      mid = (left + right) / 2;
    for (const [along, across, dy, u, v] of [
      [-length / 2, -width / 2, 0, left, 0.983],
      [-length / 2, width / 2, 0, right, 0.983],
      [0, 0, 0.07, mid, 0.76],
      [length / 2, -width / 2, -droop, left, 0.515],
      [length / 2, width / 2, -droop, right, 0.515],
    ]) {
      positions.push(x + along * c - across * s, y * 0.8 + dy, z + along * s + across * c);
      uvs.push(u, v);
      const light = 0.72 + (y + 0.5) * 0.75;
      color.setRGB(light * 1.02, light * 1.34, light * 0.93);
      colors.push(color.r, color.g, color.b);
    }
    for (const n of [0, 1, 2, 0, 2, 3, 3, 2, 4, 2, 1, 4]) indices.push(index + n);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const leaf = surfaces.alphaMaterial(
    '/assets/polyhaven/models/island_tree_02/leaves-diffuse-alpha.png',
    {
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    },
  );
  leaf.alphaToCoverage = true;
  leaf.vertexColors = true;
  const centres = orchard ? apple : broadleaf;
  const canopy = new THREE.InstancedMesh(geometry, leaf, centres.length * trees.length);
  const fruits = orchard
    ? new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 9, 7),
        new THREE.MeshStandardMaterial({ color: 0xbe4c32, roughness: 0.55 }),
        centres.length * 2 * trees.length,
      )
    : null;
  const transform = new THREE.Object3D();
  let batchIndex = 0,
    fruitIndex = 0;
  for (const tree of trees) {
    const a = tree.rotationY ?? 0,
      h = tree.height;
    for (const [x, y, z] of centres) {
      const cx = tree.x + h * (x * Math.cos(a) + z * Math.sin(a)),
        cz = tree.z + h * (z * Math.cos(a) - x * Math.sin(a));
      const size = h * (orchard ? 0.13 : 0.115) * (0.8 + random() * 0.44);
      transform.position.set(cx, tree.y + y * h, cz);
      transform.rotation.set(0, random() * Math.PI * 2, 0);
      transform.scale.set(size, size, size * (0.82 + random() * 0.21));
      transform.updateMatrix();
      canopy.setMatrixAt(batchIndex++, transform.matrix);
      if (fruits)
        for (const side of [-1, 1]) {
          transform.position.set(
            cx + side * size * 0.45,
            tree.y + h * y - size * 0.32,
            cz + size * 0.62,
          );
          transform.scale.setScalar(h * (0.0165 + random() * 0.0048));
          transform.updateMatrix();
          fruits.setMatrixAt(fruitIndex++, transform.matrix);
        }
    }
  }
  canopy.name = 'Broadleaf crowns';
  canopy.castShadow = canopy.receiveShadow = true;
  canopy.computeBoundingSphere();
  root.add(canopy);
  if (fruits) {
    fruits.name = 'Orchard apples';
    fruits.computeBoundingSphere();
    root.add(fruits);
  }
}
