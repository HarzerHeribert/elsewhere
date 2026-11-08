import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { type WorldState } from '@elsewhere/character-interfaces';
import type { AttachWorldAsset } from './worldAssets';
import { ENVIRONMENT_MATERIALS, type createEnvironmentMaterials } from './materials';
import { ResourceScope } from './sceneResources';

const town = (name: string) => `/assets/kenney/town/${name}.glb`;
const furniture = (name: string) => `/assets/kenney/furniture/${name}.glb`;
export interface VillageArchitecture {
  roofs: THREE.Group[];
  occluders: THREE.Object3D[];
  dispose(): void;
}

/** Metre-based UVs keep the scanned material at the same physical scale on every face. */
function surfaceUV(geometry: THREE.BufferGeometry, tile: number) {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal'),
    uv: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)),
      ny = Math.abs(n.getY(i)),
      nz = Math.abs(n.getZ(i));
    uv.push(
      (nx > ny && nx > nz ? p.getZ(i) : p.getX(i)) / tile,
      (ny > nx && ny > nz ? p.getZ(i) : p.getY(i)) / tile,
    );
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

/** Architectural surfaces follow the authoritative wall footprints and door openings. */
export function buildVillageArchitecture(
  world: WorldState,
  scene: THREE.Scene,
  attach: AttachWorldAsset,
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
): VillageArchitecture {
  const root = new THREE.Group();
  root.name = 'Village architecture';
  scene.add(root);
  const resources = new ResourceScope();
  const roofs: THREE.Group[] = [],
    occluders: THREE.Object3D[] = [];
  const timber = surfaces.material('timber', { normalStrength: 0.9 });
  const stone = surfaces.material('stone', { normalStrength: 1.15 });
  const tile = surfaces.material('roof', { normalStrength: 1.1 });
  tile.side = THREE.DoubleSide;
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc7d8d4,
    roughness: 0.16,
    metalness: 0.05,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
  });
  function mesh(
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D = root,
  ) {
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function beam(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat = timber,
    parent: THREE.Object3D = root,
  ) {
    const m = mesh(surfaceUV(new THREE.BoxGeometry(w, h, d), mat === stone ? 2 : 2), mat, parent);
    m.position.set(x, y + h / 2, z);
    return m;
  }
  function asset(
    path: string,
    x: number,
    y: number,
    z: number,
    height: number,
    rotation = 0,
    width?: number,
    depth?: number,
  ) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotation;
    root.add(group);
    attach(group, path, { height, width, depth });
    return group;
  }
  let seed = 8192;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stoneTransforms: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  function block(x: number, y: number, z: number, w: number, h: number, d: number, rotation = 0) {
    dummy.position.set(x, y + h / 2, z);
    dummy.rotation.set(0, rotation, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    stoneTransforms.push(dummy.matrix.clone());
  }
  for (const wall of world.obstacles) {
    if (!wall.id.includes('wall') && !wall.id.includes('door-')) continue;
    const alongX = wall.maxX - wall.minX > wall.maxZ - wall.minZ,
      length = alongX ? wall.maxX - wall.minX : wall.maxZ - wall.minZ,
      cx = (wall.minX + wall.maxX) / 2,
      cz = (wall.minZ + wall.maxZ) / 2,
      count = Math.ceil(length / 2.7),
      span = length / count,
      thickness = alongX ? wall.maxZ - wall.minZ : wall.maxX - wall.minX,
      workshop = wall.id.startsWith('workshop');
    for (let i = 0; i < count; i++) {
      const offset = -length / 2 + span * (i + 0.5),
        group = new THREE.Group();
      group.position.set(cx + (alongX ? offset : 0), 0, cz + (alongX ? 0 : offset));
      group.rotation.y = alongX ? 0 : Math.PI / 2;
      root.add(group);
      occluders.push(group);
      const aperture = (wall.sightApertures ?? []).find((opening) => {
          const middle = alongX
            ? (opening.minX + opening.maxX) / 2
            : (opening.minZ + opening.maxZ) / 2;
          return Math.abs(middle - (alongX ? cx + offset : cz + offset)) < 0.01;
        }),
        window = Boolean(aperture),
        base = workshop ? 0.5 : 0,
        shape = new THREE.Shape();
      shape.moveTo(-span / 2, base);
      shape.lineTo(span / 2, base);
      shape.lineTo(span / 2, wall.height);
      shape.lineTo(-span / 2, wall.height);
      shape.closePath();
      if (window) {
        const low = aperture!.minY,
          high = aperture!.maxY,
          left = alongX ? aperture!.minX - cx - offset : cz + offset - aperture!.maxZ,
          right = alongX ? aperture!.maxX - cx - offset : cz + offset - aperture!.minZ;
        const hole = new THREE.Path();
        hole.moveTo(left, low);
        hole.lineTo(left, high);
        hole.lineTo(right, high);
        hole.lineTo(right, low);
        hole.closePath();
        shape.holes.push(hole);
      }
      const geometry = surfaceUV(
        new THREE.ExtrudeGeometry(shape, {
          depth: thickness,
          bevelEnabled: true,
          bevelThickness: 0.012,
          bevelSize: 0.012,
          bevelSegments: 1,
          steps: 1,
        }),
        workshop ? ENVIRONMENT_MATERIALS.timber.tileMetres : ENVIRONMENT_MATERIALS.stone.tileMetres,
      );
      const uv = geometry.getAttribute('uv');
      for (let v = 0; v < uv.count; v++)
        uv.setX(v, uv.getX(v) + (alongX ? cx + offset : -cz - offset) / (workshop ? 2 : 2));
      geometry.translate(0, 0, -thickness / 2);
      mesh(geometry, workshop ? timber : stone, group);
      if (workshop) beam(span, 0.5, 0.4, 0, 0, 0, stone, group);
      if (window) {
        for (const x of [-0.52, 0.52]) beam(0.095, 1.34, 0.46, x, 0.88, 0, timber, group);
        for (const y of [0.89, 2.15]) beam(1.12, 0.09, 0.46, 0, y, 0, timber, group);
        beam(0.05, 1.2, 0.08, 0, 0.95, 0.04, timber, group);
        beam(0.96, 0.045, 0.08, 0, 1.53, 0.04, timber, group);
        beam(1.24, 0.12, 0.63, 0, 0.81, 0, stone, group);
        const pane = mesh(new THREE.PlaneGeometry(0.96, 1.2), glass, group);
        pane.position.set(0, 1.55, 0.015);
        pane.castShadow = false;
      }
    }
    // Slightly projecting, uneven plinth stones give the base a real silhouette.
    const rows = workshop ? 2 : 2;
    for (let row = 0; row < rows; row++) {
      const n = Math.ceil(length / 0.82),
        step = length / n;
      for (let i = 0; i < n; i++) {
        const offset = -length / 2 + (i + 0.5) * step;
        block(
          cx + (alongX ? offset : 0),
          0.04 + row * 0.225,
          cz + (alongX ? 0 : offset),
          step - 0.025,
          0.2 + random() * 0.025,
          0.43 + random() * 0.035,
          alongX ? 0 : Math.PI / 2,
        );
      }
    }
  }
  if (stoneTransforms.length) {
    const source = new RoundedBoxGeometry(1, 1, 1, 2, 0.045),
      parts = stoneTransforms.map((matrix) => source.clone().applyMatrix4(matrix));
    const merged = mergeGeometries(parts);
    source.dispose();
    for (const part of parts) part.dispose();
    if (merged) mesh(surfaceUV(merged, 2), stone);
  }
  for (const b of [
    {
      id: 'workshop',
      x: -5,
      z: -0.5,
      width: 8.6,
      depth: 11.6,
      height: 2.8,
      roof: 1.8,
      doorX: -1,
      doorZ: 0,
      gap: 3,
    },
    {
      id: 'library',
      x: -20.5,
      z: -17,
      width: 15.7,
      depth: 12.7,
      height: 3,
      roof: 2.5,
      doorX: -13,
      doorZ: -17,
      gap: 4,
    },
  ]) {
    const roof = new THREE.Group();
    roof.position.set(b.x, b.height, b.z);
    root.add(roof);
    roofs.push(roof);
    const half = b.width / 2 + 0.32,
      depth = b.depth + 0.65,
      rise = b.roof;
    for (const side of [-1, 1]) {
      const vertices = [
          0,
          rise,
          -depth / 2,
          side * half,
          0,
          -depth / 2,
          side * half,
          0,
          depth / 2,
          0,
          rise,
          depth / 2,
        ],
        g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      g.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          [
            0,
            0,
            Math.hypot(half, rise) / 1.5,
            0,
            Math.hypot(half, rise) / 1.5,
            depth / 1.5,
            0,
            depth / 1.5,
          ],
          2,
        ),
      );
      g.setIndex(side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      mesh(g, tile, roof);
      const fascia = beam(
        Math.hypot(half, rise),
        0.16,
        0.13,
        (side * half) / 2,
        rise / 2 - 0.08,
        -depth / 2,
        timber,
        roof,
      );
      fascia.rotation.z = -side * Math.atan2(rise, half);
      const back = fascia.clone();
      back.position.z = depth / 2;
      roof.add(back);
    }
    const ridge = mesh(
      new THREE.CylinderGeometry(0.105, 0.105, depth, 12, 1, true, 0.9 * Math.PI, 1.2 * Math.PI),
      tile,
      roof,
    );
    ridge.rotation.x = Math.PI / 2;
    ridge.position.y = rise + 0.04;
    for (const z of [b.z - b.depth / 2, b.z + b.depth / 2])
      beam(b.width, 0.16, 0.22, b.x, b.height - 0.1, z);
    for (const x of [b.x - b.width / 2 + 0.2, b.x + b.width / 2 - 0.2])
      beam(0.18, 0.18, b.depth, x, b.height - 0.1, b.z);
    // Gables close the roof ends without changing the accessible floor plan.
    for (const z of [-b.depth / 2, b.depth / 2]) {
      const shape = new THREE.Shape();
      shape.moveTo(-b.width / 2, 0);
      shape.lineTo(b.width / 2, 0);
      shape.lineTo(0, rise);
      shape.closePath();
      const face = mesh(
        surfaceUV(new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false }), 2),
        b.id === 'workshop' ? timber : stone,
        roof,
      );
      face.position.z = z - 0.08;
    }
    for (const z of [b.doorZ - b.gap / 2 - 0.15, b.doorZ + b.gap / 2 + 0.15])
      beam(0.25, b.height + 0.08, 0.25, b.doorX, 0, z);
    beam(0.28, 0.18, b.gap + 0.55, b.doorX, b.height - 0.16, b.doorZ);
    for (const z of [b.doorZ - b.gap / 2 - 0.45, b.doorZ + b.gap / 2 + 0.45])
      asset(town('lantern'), b.doorX + 0.35, 1.85, z, 0.55);
    asset(town('lantern'), b.x, 2.2, b.z, 0.55);
    const light = new THREE.PointLight(
      0xffdfa8,
      b.id === 'workshop' ? 12 : 18,
      b.id === 'workshop' ? 10 : 16,
      2,
    );
    light.position.set(b.x, 2.55, b.z);
    root.add(light);
  }
  // Photographic, alpha-cut leaves grow along thin climbing stems on the facades.
  const leafMaterial = surfaces.alphaMaterial(
    '/assets/polyhaven/models/island_tree_02/leaves-diffuse-alpha.png',
    { alphaTest: 0.45, side: THREE.DoubleSide },
  );
  leafMaterial.roughness = 0.85;
  const leafGeometry = new THREE.PlaneGeometry(0.19, 0.39, 2, 3),
    uv = leafGeometry.getAttribute('uv'),
    p = leafGeometry.getAttribute('position');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, 0.018 + uv.getX(i) * 0.16, 0.48 + uv.getY(i) * 0.51);
    p.setZ(i, 0.035 * Math.sin(uv.getY(i) * Math.PI));
  }
  leafGeometry.computeVertexNormals();
  const leaves: THREE.Matrix4[] = [];
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x6c7150, roughness: 1 });
  for (const [x, z, direction] of [
    [-12.73, -21.5, 1],
    [-12.73, -12.4, 1],
    [-9.26, 3.6, -1],
  ] as const) {
    for (let branch = 0; branch < 5; branch++) {
      const points: THREE.Vector3[] = [];
      const height = 1.3 + random() * 1.4,
        sway = (branch - 2) * 0.31;
      for (let j = 0; j <= 10; j++) {
        const t = j / 10,
          zz = z + sway * t + Math.sin(t * 5 + branch) * 0.09;
        points.push(new THREE.Vector3(x + Math.sin(t * 3 + branch) * 0.025, 0.12 + t * height, zz));
        if (j > 0)
          for (const sign of [-1, 1]) {
            dummy.position.set(
              x + direction * (0.06 + random() * 0.05),
              0.12 + t * height,
              zz + sign * (0.1 + random() * 0.1),
            );
            dummy.rotation.set(
              (random() - 0.5) * 0.55,
              (direction * Math.PI) / 2,
              (random() - 0.5) * 1.8,
            );
            dummy.scale.setScalar(0.8 + random() * 0.55);
            dummy.updateMatrix();
            leaves.push(dummy.matrix.clone());
          }
      }
      const stem = mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.009, 5, false),
        stemMaterial,
      );
      stem.castShadow = false;
    }
  }
  const leafMesh = new THREE.InstancedMesh(leafGeometry, leafMaterial, leaves.length);
  leaves.forEach((m, i) => leafMesh.setMatrixAt(i, m));
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  leafMesh.computeBoundingSphere();
  root.add(leafMesh);
  asset(furniture('bookcaseClosed'), -27.95, 0, -19, 2.35, Math.PI / 2);
  asset(furniture('bookcaseOpen'), -27.95, 0, -15, 2.35, Math.PI / 2);
  asset(furniture('pottedPlant'), -27.95, 0, -22.1, 1.25);
  asset(furniture('lampRoundFloor'), -27.95, 0, -12, 2.05);
  asset(furniture('books'), -18, 1, -14, 0.22);
  asset(furniture('cardboardBoxClosed'), -9, 0, -5.3, 0.65);
  asset(furniture('pottedPlant'), -9, 0, 4.3, 1.15);
  asset(furniture('radio'), -6.6, 1.2, -2, 0.32);
  const canopy = asset(town('stall-green'), 22.5, 0, -17.5, 3.2, 0, 8.6, 8.4);
  roofs.push(canopy);
  for (const [x, z] of [
    [18, -22],
    [27, -22],
    [18, -13],
    [27, -13],
  ] as const)
    asset(town('pillar-wood'), x, 0, z, 3.05, 0, 0.24, 0.24);
  resources.capture(root);
  return {
    roofs,
    occluders,
    dispose() {
      attach.detach(root);
      root.removeFromParent();
      resources.dispose();
    },
  };
}
