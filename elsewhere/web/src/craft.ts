import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { createEnvironmentMaterials } from './materials';
import type { ResourceScope } from './sceneResources';
import {
  SPINE_COLORS,
  WOOD_TONES,
  WORLD_PALETTE as P,
  WORLD_SCALE,
  type WoodTone,
} from './worldStyle';

/** The linear tint that turns the shared plank scan into one of the world's wood tones. */
export const woodTint = (tone: WoodTone) => new THREE.Color(...WOOD_TONES[tone]);

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

/**
 * Metre-based UVs keep a scanned material at one physical scale on every face.
 * With `grain`, boards run along that axis wherever the face allows it.
 */
export function metreUV(
  geometry: THREE.BufferGeometry,
  tile: number,
  grain?: Axis,
  offsetU = 0,
  offsetV = 0,
) {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal'),
    uv: number[] = [];
  const read = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) =>
    ({ x: attribute.getX(i), y: attribute.getY(i), z: attribute.getZ(i) }) as Record<Axis, number>;
  for (let i = 0; i < p.count; i++) {
    const normal = read(n, i),
      position = read(p, i);
    const nx = Math.abs(normal.x),
      ny = Math.abs(normal.y),
      nz = Math.abs(normal.z);
    const facing: Axis = nx > ny && nx > nz ? 'x' : ny > nz ? 'y' : 'z';
    let u: Axis = facing === 'x' ? 'z' : 'x',
      v: Axis = facing === 'y' ? 'z' : 'y';
    if (grain && grain !== facing) {
      v = grain;
      u = AXES.find((axis) => axis !== facing && axis !== grain)!;
    }
    uv.push(position[u] / tile + offsetU, position[v] / tile + offsetV);
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

/** Marks a mesh that animates or is picked on its own, so `merge` leaves it alone. */
export const separate = <T extends THREE.Object3D>(object: T) => {
  object.userData.separate = true;
  return object;
};

/**
 * The crafted-object kit: one set of materials and softly bevelled joinery for every
 * authored thing in the world, from a bookcase to a signpost.
 */
export function createCraftKit(
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
  resources: ResourceScope,
) {
  const cache = new Map<string, THREE.Material>();
  function keep<T extends THREE.Material>(key: string, make: () => T): T {
    let material = cache.get(key) as T | undefined;
    if (!material) {
      material = resources.own(make(), true);
      cache.set(key, material);
    }
    return material;
  }
  const wood = (tone: WoodTone = 'oak') =>
    keep(`wood:${tone}`, () =>
      surfaces.material('timber', {
        tint: woodTint(tone),
        normalStrength: 0.5,
        envMapIntensity: 0.45,
        shared: true,
      }),
    );
  const stone = () =>
    keep('stone', () => surfaces.material('stone', { normalStrength: 0.8, shared: true }));
  const paint = (color: number, roughness = 0.72) =>
    keep(
      `paint:${color}:${roughness}`,
      () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }),
    );
  const metal = (color: number = P.brass, roughness = 0.42) =>
    keep(
      `metal:${color}:${roughness}`,
      () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.8 }),
    );
  const glow = (color: number = P.lamplight, intensity = 2.6) =>
    keep(
      `glow:${color}:${intensity}`,
      () =>
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: intensity,
          roughness: 0.4,
        }),
    );
  const glass = () =>
    keep(
      'glass',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0xc7d8d4,
          roughness: 0.12,
          metalness: 0.05,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
        }),
    );

  let seed = 90210;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function place<T extends THREE.Mesh>(parent: THREE.Object3D, mesh: T) {
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  /** A softly bevelled board. `y` is its underside. */
  function box(
    parent: THREE.Object3D,
    material: THREE.Material,
    w: number,
    h: number,
    d: number,
    x = 0,
    y = 0,
    z = 0,
    options: { radius?: number; grain?: Axis; tile?: number } = {},
  ) {
    const radius = Math.min(options.radius ?? 0.012, Math.min(w, h, d) * 0.45);
    const longest: Axis = w >= h && w >= d ? 'x' : h >= d ? 'y' : 'z';
    const geometry =
      radius > 0.002 ? new RoundedBoxGeometry(w, h, d, 1, radius) : new THREE.BoxGeometry(w, h, d);
    metreUV(geometry, options.tile ?? 1.3, options.grain ?? longest, random(), random());
    const mesh = place(parent, new THREE.Mesh(geometry, material));
    mesh.position.set(x, y + h / 2, z);
    return mesh;
  }
  /** An upright turned piece. `y` is its underside. */
  function rod(
    parent: THREE.Object3D,
    material: THREE.Material,
    radius: number,
    h: number,
    x = 0,
    y = 0,
    z = 0,
    options: { top?: number; sides?: number; tile?: number } = {},
  ) {
    const geometry = new THREE.CylinderGeometry(
      options.top ?? radius,
      radius,
      h,
      options.sides ?? 14,
    );
    const uv = geometry.getAttribute('uv'),
      tile = options.tile ?? 1.3,
      offset = random();
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (uv.getX(i) * Math.PI * 2 * radius) / tile + offset, (uv.getY(i) * h) / tile);
    const mesh = place(parent, new THREE.Mesh(geometry, material));
    mesh.position.set(x, y + h / 2, z);
    return mesh;
  }
  const up = new THREE.Vector3(0, 1, 0);
  /** A round member between two points: legs, braces, chains and stems. */
  function strut(
    parent: THREE.Object3D,
    material: THREE.Material,
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    radius: number,
    sides = 8,
  ) {
    const a = new THREE.Vector3(...from),
      b = new THREE.Vector3(...to),
      length = a.distanceTo(b);
    const mesh = rod(parent, material, radius, length, 0, 0, 0, { sides });
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
    return mesh;
  }
  function ball(
    parent: THREE.Object3D,
    material: THREE.Material,
    radius: number,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const mesh = place(parent, new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), material));
    mesh.position.set(x, y, z);
    return mesh;
  }
  function solid(
    parent: THREE.Object3D,
    material: THREE.Material,
    geometry: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const mesh = place(parent, new THREE.Mesh(geometry, material));
    mesh.position.set(x, y, z);
    return mesh;
  }

  /** Bakes a finished object into one mesh per material. Animated parts stay separate. */
  function merge(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const merged: THREE.Mesh[] = [];
    root.traverse((node) => {
      if (
        !(node instanceof THREE.Mesh) ||
        node instanceof THREE.InstancedMesh ||
        Array.isArray(node.material)
      )
        return;
      for (let a: THREE.Object3D | null = node; a && a !== root; a = a.parent)
        if (a.userData.separate) return;
      const source = node.geometry as THREE.BufferGeometry;
      if (!source.getAttribute('normal') || !source.getAttribute('uv')) return;
      const geometry = source.index ? source.toNonIndexed() : source.clone();
      for (const name of Object.keys(geometry.attributes))
        if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
      geometry.applyMatrix4(inverse.clone().multiply(node.matrixWorld));
      const parts = byMaterial.get(node.material) ?? [];
      parts.push(geometry);
      byMaterial.set(node.material, parts);
      merged.push(node);
    });
    for (const mesh of merged) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    for (const [material, parts] of byMaterial) {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    return root;
  }

  // ── Shared furnishings ────────────────────────────────────────────────────────────

  /** A row of books standing on a shelf, with the odd gap and leaning volume. */
  function books(parent: THREE.Object3D, x0: number, x1: number, y: number, z: number, d: number) {
    let x = x0;
    while (x < x1 - 0.03) {
      if (random() < 0.07) {
        x += 0.08 + random() * 0.16;
        continue;
      }
      const thickness = Math.min(0.026 + random() * 0.034, x1 - x),
        height = 0.19 + random() * 0.1,
        depth = d * (0.72 + random() * 0.22);
      const book = box(
        parent,
        paint(SPINE_COLORS[Math.floor(random() * SPINE_COLORS.length)]!, 0.8),
        thickness,
        height,
        depth,
        x + thickness / 2,
        y,
        z + (d - depth) / 2,
        { radius: 0 },
      );
      if (random() < 0.06) book.rotation.z = -0.16;
      x += thickness + 0.002;
    }
  }
  /** Open shelving facing +z, full of books. Its back sits at z = -depth / 2. */
  function bookcase(parent: THREE.Object3D, width: number, height: number, depth: number) {
    const group = new THREE.Group();
    parent.add(group);
    const frame = wood('walnut'),
      board = 0.04;
    for (const side of [-1, 1])
      box(group, frame, board, height, depth, (side * (width - board)) / 2, 0, 0, { grain: 'y' });
    box(group, frame, width + 0.08, 0.05, depth + 0.05, 0, height, 0);
    box(group, frame, width, 0.09, depth, 0, 0, 0);
    box(
      group,
      paint(P.forest, 0.85),
      width - board,
      height - 0.09,
      0.015,
      0,
      0.09,
      -depth / 2 + 0.01,
      {
        radius: 0,
      },
    );
    const shelves = Math.max(2, Math.round((height - 0.09) / 0.39)),
      gap = (height - 0.09) / shelves;
    for (let row = 0; row < shelves; row++) {
      const y = 0.09 + row * gap;
      if (row) box(group, wood('oak'), width - board * 2, 0.025, depth - 0.03, 0, y - 0.025, 0.01);
      books(group, -width / 2 + board + 0.01, width / 2 - board - 0.01, y, 0.02, depth - 0.08);
    }
    return group;
  }
  /** A short stack of books lying flat. */
  function bookStack(parent: THREE.Object3D, x: number, y: number, z: number, count = 3) {
    for (let i = 0; i < count; i++) {
      const book = box(
        parent,
        paint(SPINE_COLORS[(i * 3 + 1) % SPINE_COLORS.length]!, 0.8),
        0.21 - i * 0.012,
        0.034,
        0.15 - i * 0.008,
        x,
        y + i * 0.035,
        z,
        { radius: 0.004 },
      );
      book.rotation.y = 0.3 - i * 0.22;
    }
  }
  /** An iron and glass lantern hanging from the point (x, y, z). */
  function lantern(parent: THREE.Object3D, x: number, y: number, z: number, size = 1) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.scale.setScalar(size);
    parent.add(group);
    const iron = metal(P.iron, 0.6);
    solid(group, iron, new THREE.TorusGeometry(0.022, 0.006, 6, 12), 0, -0.022, 0);
    const cap = solid(group, iron, new THREE.ConeGeometry(0.115, 0.075, 4), 0, -0.08, 0);
    cap.rotation.y = Math.PI / 4;
    box(group, glow(), 0.105, 0.17, 0.105, 0, -0.29, 0, { radius: 0 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        box(group, iron, 0.014, 0.18, 0.014, sx * 0.058, -0.295, sz * 0.058, { radius: 0 });
    box(group, iron, 0.15, 0.016, 0.15, 0, -0.31, 0, { radius: 0 });
    return group;
  }
  /** A bracket lantern fixed to a wall face, reaching `reach` metres along +x. */
  function wallLantern(parent: THREE.Object3D, x: number, y: number, z: number, reach = 0.3) {
    const iron = metal(P.iron, 0.6);
    box(parent, iron, 0.02, 0.26, 0.07, x + 0.01, y - 0.2, z, { radius: 0 });
    strut(parent, iron, [x, y, z], [x + reach, y, z], 0.011, 6);
    strut(parent, iron, [x, y - 0.17, z], [x + reach * 0.72, y - 0.005, z], 0.008, 6);
    return lantern(parent, x + reach - 0.02, y, z);
  }
  /** A terracotta pot; the caller plants something at the returned soil height. */
  function pot(parent: THREE.Object3D, x: number, z: number, height = 0.3) {
    const clay = paint(P.terracotta, 0.9),
      r = height * 0.62;
    rod(parent, clay, r * 0.68, height, x, 0, z, { top: r, sides: 18 });
    const rim = solid(parent, clay, new THREE.TorusGeometry(r, height * 0.07, 8, 20), x, height, z);
    rim.rotation.x = Math.PI / 2;
    rod(parent, paint(P.soil, 1), r * 0.93, 0.02, x, height - 0.03, z, { sides: 18 });
    return height - 0.02;
  }
  function floorLamp(parent: THREE.Object3D, x: number, z: number) {
    const iron = metal(P.iron, 0.6);
    rod(parent, iron, 0.15, 0.025, x, 0, z, { sides: 20 });
    rod(parent, iron, 0.013, 1.5, x, 0.025, z, { sides: 8 });
    ball(parent, glow(P.lamplight, 3), 0.05, x, 1.5, z);
    const shade = solid(
      parent,
      keep(
        'shade',
        () =>
          new THREE.MeshStandardMaterial({
            color: P.linen,
            emissive: P.lamplight,
            emissiveIntensity: 0.55,
            roughness: 0.9,
            side: THREE.DoubleSide,
          }),
      ),
      new THREE.CylinderGeometry(0.12, 0.21, 0.26, 20, 1, true),
      x,
      1.53,
      z,
    );
    shade.castShadow = false;
  }
  /** A slatted packing crate resting on the floor. */
  function crate(parent: THREE.Object3D, x: number, z: number, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    parent.add(group);
    const w = 0.56,
      h = 0.4,
      d = 0.42,
      slat = wood('weathered');
    box(group, paint(P.soil, 1), w - 0.04, h - 0.03, d - 0.04, 0, 0.015, 0, { radius: 0 });
    for (let row = 0; row < 3; row++) {
      const y = 0.02 + row * 0.13;
      for (const side of [-1, 1]) {
        box(group, slat, w, 0.105, 0.018, 0, y, (side * d) / 2);
        box(group, slat, 0.018, 0.105, d, (side * w) / 2, y, 0);
      }
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        box(group, wood('walnut'), 0.04, h, 0.04, (sx * w) / 2, 0, (sz * d) / 2, { grain: 'y' });
    return group;
  }
  /** A small wireless with a cloth front, resting on a surface at height `y`. */
  function radio(parent: THREE.Object3D, x: number, y: number, z: number, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotation;
    parent.add(group);
    box(group, wood('walnut'), 0.3, 0.19, 0.12, 0, 0, 0, { radius: 0.03 });
    box(group, paint(P.linen, 0.95), 0.15, 0.12, 0.01, -0.05, 0.035, 0.058, { radius: 0.004 });
    for (const ky of [0.06, 0.125]) {
      const knob = rod(group, metal(), 0.017, 0.016, 0.085, 0, 0, { sides: 12 });
      knob.rotation.x = Math.PI / 2;
      knob.position.set(0.085, ky, 0.066);
    }
    strut(group, metal(P.iron, 0.5), [0.11, 0.19, -0.03], [0.2, 0.47, -0.03], 0.004, 5);
    return group;
  }
  /** A way-marker: a post with a painted board. Faces ±z. */
  function signpost(parent: THREE.Object3D, height: number = WORLD_SCALE.sign) {
    const post = wood('walnut');
    box(parent, post, 0.075, height, 0.075, 0, 0, 0, { grain: 'y' });
    box(parent, post, 0.11, 0.03, 0.11, 0, height, 0);
    box(parent, wood('oak'), 0.56, 0.27, 0.035, 0, height - 0.37, 0.05, { grain: 'x' });
    box(parent, paint(P.cream, 0.8), 0.48, 0.19, 0.008, 0, height - 0.33, 0.068, { radius: 0.003 });
    for (const line of [0, 1])
      box(
        parent,
        paint(P.forest, 0.8),
        0.34 - line * 0.1,
        0.018,
        0.004,
        -line * 0.05,
        height - 0.2 - line * 0.06,
        0.073,
        { radius: 0 },
      );
  }
  /** A pair of field-gate leaves closing an opening `width` metres wide, along x. */
  function fieldGate(parent: THREE.Object3D, width = 2) {
    const timber = wood('weathered'),
      iron = metal(P.iron, 0.6);
    for (const side of [-1, 1]) {
      const postX = (side * width) / 2;
      box(parent, wood('walnut'), 0.17, 1.28, 0.17, postX, 0, 0, { grain: 'y' });
      box(parent, wood('walnut'), 0.22, 0.04, 0.22, postX, 1.28, 0);
      const leaf = width / 2 - 0.13,
        centre = side * (0.02 + leaf / 2);
      for (const y of [0.2, 0.52, 0.86])
        box(parent, timber, leaf, 0.085, 0.04, centre, y, 0, { grain: 'x' });
      for (const end of [-1, 1])
        box(parent, timber, 0.075, 0.9, 0.05, centre + (end * (leaf - 0.075)) / 2, 0.12, 0, {
          grain: 'y',
        });
      const brace = box(
        parent,
        timber,
        Math.hypot(leaf - 0.1, 0.62),
        0.07,
        0.03,
        centre,
        0.535,
        0.025,
        {
          grain: 'x',
        },
      );
      brace.rotation.z = side * Math.atan2(0.62, leaf - 0.1);
      for (const y of [0.3, 0.84])
        box(parent, iron, 0.2, 0.035, 0.012, postX - side * 0.17, y, 0.03, { radius: 0 });
    }
    box(parent, iron, 0.14, 0.03, 0.02, 0, 0.6, 0.035, { radius: 0 });
  }

  return {
    wood,
    stone,
    paint,
    metal,
    glow,
    glass,
    box,
    rod,
    strut,
    ball,
    solid,
    merge,
    random,
    books,
    bookcase,
    bookStack,
    lantern,
    wallLantern,
    pot,
    floorLamp,
    crate,
    radio,
    signpost,
    fieldGate,
  };
}
export type CraftKit = ReturnType<typeof createCraftKit>;
