import * as THREE from 'three';
import type { VillageScenery } from './scenery';
import type { AssetInstance } from './worldAssets';
import { MEADOW_TRAILS, landscapeHeight } from './landscapeLayout';
import { applyWind } from './wind';
import { WORLD_PALETTE as P } from './worldStyle';

type Point = readonly [number, number, number];

/** Collects coloured triangles for one small plant; every plant is one unit tall. */
function sculptor() {
  const positions: number[] = [],
    colors: number[] = [];
  const tint = new THREE.Color();
  function tri(a: Point, b: Point, c: Point, ca: number, cb = ca, cc = ca) {
    for (const [point, color] of [
      [a, ca],
      [b, cb],
      [c, cc],
    ] as const) {
      positions.push(...point);
      tint.set(color);
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  function quad(a: Point, b: Point, c: Point, d: Point, low: number, high = low) {
    tri(a, b, c, low, low, high);
    tri(a, c, d, low, high, high);
  }
  /** A three-sided stem between two points. */
  function stem(from: Point, to: Point, radius: number, color: number) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2,
        b = ((i + 1) / 3) * Math.PI * 2;
      quad(
        [from[0] + Math.cos(a) * radius, from[1], from[2] + Math.sin(a) * radius],
        [from[0] + Math.cos(b) * radius, from[1], from[2] + Math.sin(b) * radius],
        [to[0] + Math.cos(b) * radius * 0.6, to[1], to[2] + Math.sin(b) * radius * 0.6],
        [to[0] + Math.cos(a) * radius * 0.6, to[1], to[2] + Math.sin(a) * radius * 0.6],
        color,
      );
    }
  }
  /** A pointed leaf or petal leaving `from` along `yaw`, rising then falling by `droop`. */
  function blade(
    from: Point,
    yaw: number,
    length: number,
    width: number,
    lift: number,
    droop: number,
    low: number,
    high: number,
  ) {
    const dx = Math.cos(yaw),
      dz = Math.sin(yaw);
    const mid = (side: number): Point => [
      from[0] + dx * length * 0.5 - dz * side * width * 0.5,
      from[1] + lift,
      from[2] + dz * length * 0.5 + dx * side * width * 0.5,
    ];
    const tip: Point = [from[0] + dx * length, from[1] + lift - droop, from[2] + dz * length];
    tri(from, mid(1), mid(-1), low, high, high);
    tri(mid(-1), mid(1), tip, high);
  }
  function build(flatNormals = false) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (flatNormals) {
      // Blades shade like the ground they grow from, so a meadow reads as one surface.
      const up = new Float32Array(positions.length);
      for (let i = 1; i < up.length; i += 3) up[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(up, 3));
    } else geometry.computeVertexNormals();
    return geometry;
  }
  return { tri, quad, stem, blade, build };
}

function poppy() {
  const s = sculptor();
  s.stem([0, 0, 0], [0.03, 0.88, 0.02], 0.014, P.leafDeep);
  s.blade([0, 0.2, 0], 0.7, 0.26, 0.09, 0.1, 0.02, P.leafDeep, P.leaf);
  s.blade([0.01, 0.38, 0.01], 3.6, 0.22, 0.08, 0.09, 0.02, P.leafDeep, P.leaf);
  for (let i = 0; i < 5; i++)
    s.blade(
      [0.03, 0.88, 0.02],
      (i / 5) * Math.PI * 2 + 0.3,
      0.17,
      0.17,
      0.09,
      -0.03,
      0x8f2f22,
      P.poppy,
    );
  s.blade([0.03, 0.9, 0.02], 0, 0.035, 0.05, 0.02, 0, 0x2b2a22, 0x2b2a22);
  s.blade([0.03, 0.9, 0.02], Math.PI, 0.035, 0.05, 0.02, 0, 0x2b2a22, 0x2b2a22);
  return s.build();
}
function buttercup() {
  const s = sculptor();
  for (const [x, z, top] of [
    [0.1, 0.02, 1],
    [-0.09, 0.07, 0.8],
    [-0.02, -0.11, 0.64],
  ] as const) {
    s.stem([0, 0, 0], [x, top - 0.02, z], 0.011, P.leaf);
    for (let i = 0; i < 5; i++)
      s.blade(
        [x, top - 0.02, z],
        (i / 5) * Math.PI * 2 + top,
        0.085,
        0.08,
        0.025,
        -0.012,
        0xd9a933,
        P.buttercup,
      );
  }
  for (let i = 0; i < 4; i++)
    s.blade([0, 0.02, 0], i * 1.7 + 0.4, 0.24, 0.1, 0.16, 0.05, P.leafDeep, P.leaf);
  return s.build();
}
function groundcover() {
  const s = sculptor();
  for (let i = 0; i < 9; i++) {
    const yaw = i * 2.4,
      length = 0.55 + (i % 3) * 0.16;
    s.blade(
      [0, 0.02, 0],
      yaw,
      length,
      0.3,
      0.55 + (i % 2) * 0.4,
      0.3,
      P.leafDeep,
      i % 2 ? 0x6f9a4c : P.leaf,
    );
  }
  return s.build();
}
function mushrooms() {
  const s = sculptor();
  for (const [x, z, h] of [
    [0, 0, 1],
    [0.42, 0.18, 0.66],
    [-0.2, 0.4, 0.5],
  ] as const) {
    s.stem([x, 0, z], [x, h * 0.7, z], 0.09 * h, P.cream);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2,
        b = ((i + 1) / 8) * Math.PI * 2,
        r = 0.34 * h;
      s.tri(
        [x, h, z],
        [x + Math.cos(b) * r, h * 0.66, z + Math.sin(b) * r],
        [x + Math.cos(a) * r, h * 0.66, z + Math.sin(a) * r],
        0xc9694a,
        P.clay,
        P.clay,
      );
    }
  }
  return s.build();
}
function tuft() {
  const s = sculptor();
  for (let i = 0; i < 5; i++) {
    const yaw = i * 1.31 + 0.3,
      lean = 0.16 + (i % 3) * 0.14,
      height = 1 - (i % 3) * 0.22,
      dx = Math.cos(yaw),
      dz = Math.sin(yaw),
      half = 0.075;
    const at = (t: number, side: number): Point => [
      dx * lean * t * t + -dz * side * half * (1 - t * 0.7) + dx * 0.16,
      height * t,
      dz * lean * t * t + dx * side * half * (1 - t * 0.7) + dz * 0.16,
    ];
    s.quad(at(0, -1), at(0, 1), at(0.55, 1), at(0.55, -1), 0x587a33, 0x7fa446);
    s.tri(at(0.55, -1), at(0.55, 1), at(1, 0), 0x7fa446, 0x7fa446, 0xa9c862);
  }
  return s.build(true);
}

const FLORA = { poppy, buttercup, groundcover, mushrooms, tuft } as const;
export type FloraKind = keyof typeof FLORA;

/** One instanced, wind-blown batch of a hand-shaped plant, coloured from the world palette. */
export function plantFlora(
  parent: THREE.Object3D,
  kind: FloraKind,
  placements: readonly AssetInstance[],
  options: { shadow?: boolean } = {},
) {
  if (!placements.length) return null;
  const material = applyWind(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.4,
    }),
    { weight: 'position.y * position.y', strength: kind === 'tuft' ? 0.16 : 0.1, key: 'flora' },
  );
  if (kind === 'tuft') {
    // Both faces of a blade take the ground's upward normal; a flipped back face would go dark.
    const sway = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      sway.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize(vNormal);',
      );
    };
    material.customProgramCacheKey = () => 'wind:flora:tuft';
  }
  const mesh = new THREE.InstancedMesh(FLORA[kind](), material, placements.length);
  const transform = new THREE.Object3D();
  placements.forEach((placement, i) => {
    transform.position.set(placement.x, placement.y, placement.z);
    transform.rotation.set(0, placement.rotationY ?? 0, 0);
    transform.scale.setScalar(placement.height);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.name = `Flora: ${kind}`;
  mesh.castShadow = options.shadow ?? false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

/** Meadow grass over the whole valley floor, kept off floors, paths, water and paving. */
export function meadowGrass(world: VillageScenery) {
  let seed = 52711;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pond = world.objects.find((object) => object.kind === 'pond')?.position;
  const blocked = (x: number, z: number) =>
    world.places.some(
      (place) =>
        ['workshop', 'library'].includes(place.id) &&
        x > place.bounds.minX - 0.45 &&
        x < place.bounds.maxX + 0.45 &&
        z > place.bounds.minZ - 0.45 &&
        z < place.bounds.maxZ + 0.45,
    ) ||
    world.obstacles.some(
      (o) => x > o.minX - 0.12 && x < o.maxX + 0.12 && z > o.minZ - 0.12 && z < o.maxZ + 0.12,
    ) ||
    (pond !== undefined && Math.hypot(x - pond.x, z - pond.z) < 4.85) ||
    Math.hypot(x - 3, z - 3) < 2.8;
  const trail = (x: number, z: number) => {
    let nearest = Infinity;
    for (const [a, b] of MEADOW_TRAILS) {
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        t = THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
      nearest = Math.min(nearest, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
    }
    return nearest;
  };
  const tufts: AssetInstance[] = [];
  const reach = 10,
    { minX, maxX, minZ, maxZ } = world.bounds;
  const cell = 0.4;
  for (let x = minX - reach; x < maxX + reach; x += cell)
    for (let z = minZ - reach; z < maxZ + reach; z += cell) {
      const px = x + random() * cell,
        pz = z + random() * cell;
      const outside = Math.max(minX - px, px - maxX, minZ - pz, pz - maxZ, 0);
      // Growth thins towards the surrounding pasture instead of stopping at the fence.
      if (random() < outside / reach || blocked(px, pz)) continue;
      const path = trail(px, pz);
      if (path < 1) continue;
      // Soft drifts of taller grass, shorter where feet pass.
      const drift = 0.5 + 0.5 * Math.sin(px * 0.31 + pz * 0.17) * Math.cos(pz * 0.23 - px * 0.11);
      tufts.push({
        x: px,
        y: landscapeHeight(Math.hypot(px, pz), Math.atan2(pz, px)) - 0.01,
        z: pz,
        height: (0.1 + drift * 0.11 + random() * 0.07) * THREE.MathUtils.smoothstep(path, 1, 1.8),
        rotationY: random() * Math.PI * 2,
      });
    }
  return tufts.filter((placement) => placement.height > 0.05);
}
