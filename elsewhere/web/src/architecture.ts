import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { VillageScenery } from './scenery';
import { WORLD_ASSETS, type AttachWorldAsset } from './worldAssets';
import { woodTint, type CraftKit } from './craft';
import { WORLD_PALETTE, WORLD_SCALE } from './worldStyle';
import { ENVIRONMENT_MATERIALS, type createEnvironmentMaterials } from './materials';
import { ResourceScope } from './sceneResources';

export interface VillageArchitecture {
  roofs: THREE.Group[];
  occluders: THREE.Object3D[];
  renderedObstacleIds: ReadonlySet<string>;
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
  world: VillageScenery,
  scene: THREE.Scene,
  attach: AttachWorldAsset,
  surfaces: ReturnType<typeof createEnvironmentMaterials>,
  craft: CraftKit,
): VillageArchitecture {
  const root = new THREE.Group();
  root.name = 'Village architecture';
  scene.add(root);
  const resources = new ResourceScope();
  const roofs: THREE.Group[] = [],
    occluders: THREE.Object3D[] = [];
  const renderedObstacleIds = new Set<string>();
  // Cladding and trim are two tones of the one plank scan that all joinery shares.
  const cladding = surfaces.material('timber', {
    normalStrength: 0.9,
    tint: woodTint('cladding'),
  });
  const timber = surfaces.material('timber', { normalStrength: 0.7, tint: woodTint('walnut') });
  const stone = surfaces.material('stone', { normalStrength: 1.15 });
  const mint = new THREE.MeshStandardMaterial({ color: 0x739989, roughness: 0.78 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf0dfb8, roughness: 0.88 });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xc99b53,
    metalness: 0.36,
    roughness: 0.48,
  });
  const clay = new THREE.MeshStandardMaterial({ color: 0xb26946, roughness: 0.89 });
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
    mat: THREE.Material = timber,
    parent: THREE.Object3D = root,
  ) {
    const m = mesh(surfaceUV(new THREE.BoxGeometry(w, h, d), mat === stone ? 2 : 2), mat, parent);
    m.position.set(x, y + h / 2, z);
    return m;
  }
  let seed = 8192;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const furnishings = new THREE.Group();
  furnishings.name = 'Village furnishings';
  root.add(furnishings);
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
    if (!/^(workshop|library)-(.*wall|door-)/.test(wall.id)) continue;
    renderedObstacleIds.add(wall.id);
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
      mesh(geometry, workshop ? cladding : stone, group);
      if (workshop) beam(span, 0.5, 0.4, 0, 0, 0, stone, group);
      if (window) {
        for (const x of [-0.52, 0.52]) beam(0.095, 1.34, 0.46, x, 0.88, 0, timber, group);
        for (const y of [0.89, 2.15]) beam(1.12, 0.09, 0.46, 0, y, 0, timber, group);
        beam(0.05, 1.2, 0.08, 0, 0.95, 0.04, timber, group);
        beam(0.96, 0.045, 0.08, 0, 1.53, 0.04, timber, group);
        beam(1.24, 0.12, 0.63, 0, 0.81, 0, stone, group);
        for (const side of [-1, 1]) {
          for (const x of [-0.77, 0.77]) {
            beam(0.35, 1.15, 0.055, x, 0.96, side * 0.225, mint, group);
            for (const y of [1.08, 1.9])
              beam(0.36, 0.065, 0.065, x, y, side * 0.249, timber, group);
          }
        }
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
    roof.userData.placeId = b.id;
    roof.position.set(b.x, b.height, b.z);
    const library = b.id === 'library';
    const tile = surfaces.material('roof', {
      tint: library ? new THREE.Color(0.99, 1.65, 1.7) : new THREE.Color(2.15, 1.1, 0.74),
      normalStrength: 0.9,
      side: THREE.DoubleSide,
    });
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
        library ? stone : cream,
        roof,
      );
      face.position.z = z - 0.08;
    }
    if (library) {
      // The lantern tower gives the reading room a landmark above the tree line.
      const towerZ = 1.5,
        base = rise - 0.32;
      beam(1.76, 1.3, 1.76, 0, base, towerZ, cream, roof);
      for (const x of [-0.82, 0.82])
        for (const z of [towerZ - 0.82, towerZ + 0.82])
          beam(0.14, 1.35, 0.14, x, base, z, timber, roof);
      for (const side of [-1, 1]) {
        for (let slit = -1; slit <= 1; slit++) {
          beam(0.15, 0.62, 0.05, slit * 0.3, base + 0.36, towerZ + side * 0.89, mint, roof);
          beam(0.05, 0.62, 0.15, side * 0.89, base + 0.36, towerZ + slit * 0.3, mint, roof);
        }
      }
      const spire = mesh(new THREE.ConeGeometry(1.68, 1.82, 4), mint, roof);
      spire.rotation.y = Math.PI / 4;
      spire.position.set(0, base + 2.2, towerZ);
      const finial = mesh(new THREE.SphereGeometry(0.12, 10, 8), brass, roof);
      finial.position.set(0, base + 3.12, towerZ);
    } else {
      // The flue meets the workshop's roof on the far slope, leaving the entry face open.
      const flueX = -1.58,
        flueZ = -3.6;
      beam(0.85, 1.82, 0.95, flueX, rise - 0.86, flueZ, stone, roof);
      beam(1.02, 0.16, 1.13, flueX, rise + 0.92, flueZ, cream, roof);
      for (const z of [flueZ - 0.23, flueZ + 0.23]) {
        const pot = mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.44, 10), clay, roof);
        pot.position.set(flueX, rise + 1.3, z);
        const lip = mesh(new THREE.TorusGeometry(0.146, 0.041, 6, 12), clay, roof);
        lip.rotation.x = Math.PI / 2;
        lip.position.set(flueX, rise + 1.52, z);
      }
    }
    // A striped canvas shades each door. Both awnings cantilever above eye height.
    const awningWidth = b.gap + 0.76,
      bands = 9,
      band = awningWidth / bands;
    const canvasMat = library ? mint : clay;
    for (let i = 0; i < bands; i++) {
      const z = b.doorZ - awningWidth / 2 + band * (i + 0.5);
      const stripe = beam(
        1.5,
        0.065,
        band,
        b.doorX + 0.7,
        b.height - 0.21,
        z,
        i % 2 ? cream : canvasMat,
      );
      stripe.rotation.z = -0.22;
      beam(0.068, 0.19, band, b.doorX + 1.42, b.height - 0.5, z, i % 2 ? cream : canvasMat);
    }
    for (const z of [b.doorZ - b.gap / 2 - 0.15, b.doorZ + b.gap / 2 + 0.15])
      beam(0.25, b.height + 0.08, 0.25, b.doorX, 0, z);
    beam(0.28, 0.18, b.gap + 0.55, b.doorX, b.height - 0.16, b.doorZ);
    // Bracket lanterns flank each door; one larger lantern hangs from the ridge inside.
    for (const z of [b.doorZ - b.gap / 2 - 0.75, b.doorZ + b.gap / 2 + 0.75])
      craft.wallLantern(furnishings, b.doorX + 0.2, WORLD_SCALE.lantern, z);
    const pendant = new THREE.Group();
    roof.add(pendant);
    craft.strut(
      pendant,
      craft.metal(WORLD_PALETTE.iron, 0.6),
      [0, rise - 0.06, 0],
      [0, -0.32, 0],
      0.007,
      5,
    );
    craft.lantern(pendant, 0, -0.32, 0, 1.7);
    craft.merge(pendant);
    const light = new THREE.PointLight(
      0xffdfa8,
      b.id === 'workshop' ? 12 : 18,
      b.id === 'workshop' ? 10 : 16,
      2,
    );
    light.position.set(b.x, 2.1, b.z);
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
  // Furnishings stand on the floor against the inner wall faces, never inside them.
  for (const z of [-19.4, -14.6]) {
    const shelves = craft.bookcase(furnishings, 2.6, 2.15, 0.34);
    shelves.position.set(-27.62, 0.055, z);
    shelves.rotation.y = Math.PI / 2;
  }
  craft.floorLamp(furnishings, -27.2, -11.75);
  for (const [x, z, height] of [
    [-27.25, -22.3, 0.36],
    [-8.3, 4.3, 0.32],
    [-1.75, 4.3, 0.28],
  ] as const) {
    const soil = craft.pot(furnishings, x, z, height);
    const plant = new THREE.Group();
    plant.position.set(x, soil, z);
    furnishings.add(plant);
    attach(plant, WORLD_ASSETS.fern, { height: height * 1.7 });
  }
  craft.crate(furnishings, -8.25, -5.2, 0.2);
  craft.crate(furnishings, -7.55, -5.25, -0.15);
  craft.crate(furnishings, -8.2, -5.22, 0.45).position.y = 0.42;
  craft.merge(furnishings);
  const canopy = new THREE.Group();
  canopy.name = 'Lookout vine arbor';
  canopy.userData.placeId = 'lookout';
  root.add(canopy);
  roofs.push(canopy);
  for (const x of [18, 27])
    for (const z of [-22, -13]) {
      beam(0.5, 0.38, 0.5, x, 0, z, stone);
      beam(0.24, 3.08, 0.24, x, 0.37, z, timber);
      for (const alongX of [true, false]) {
        const towards = alongX ? (x === 18 ? 1 : -1) : z === -22 ? 1 : -1;
        const brace = beam(
          0.14,
          1.15,
          0.14,
          x + (alongX ? towards * 0.4 : 0),
          2.35,
          z + (alongX ? 0 : towards * 0.4),
          timber,
        );
        if (alongX) brace.rotation.z = (-towards * Math.PI) / 4;
        else brace.rotation.x = (towards * Math.PI) / 4;
      }
    }
  for (const z of [-22, -13]) beam(9.86, 0.23, 0.18, 22.5, 3.32, z, timber, canopy);
  for (const x of [18, 27]) beam(0.2, 0.24, 9.86, x, 3.34, -17.5, timber, canopy);
  for (let i = 0; i <= 13; i++) {
    const z = -22 + i * 0.69;
    if (i < 6 || i > 10) beam(9.9, 0.15, 0.12, 22.5, 3.55, z, timber, canopy);
    else beam(2.3, 0.15, 0.12, 26.22, 3.55, z, timber, canopy);
  }
  // Climbing stems follow the columns and run across the slats. Only the overhead growth disappears in cutaway.
  const arborLeaves: THREE.Matrix4[] = [];
  for (let vine = 0; vine < 12; vine++) {
    const x0 = vine % 2 ? 27 : 18,
      z0 = vine % 3 ? -22 : -13;
    const points: THREE.Vector3[] = [];
    for (let j = 0; j <= 28; j++) {
      const t = j / 28,
        h = Math.min(1, t * 2.6),
        spread = Math.max(0, (t - 1 / 2.6) * 1.62);
      const x =
        x0 + Math.sin(t * 13 + vine) * 0.15 + spread * (x0 === 18 ? 1 : -1) * (3 + (vine % 4));
      const z =
        z0 + Math.cos(t * 11 + vine) * 0.17 + spread * (z0 === -22 ? 1 : -1) * (1 + (vine % 3));
      const y = h * 3.62 + Math.sin(t * 14 + vine) * spread * 0.18;
      points.push(new THREE.Vector3(x, y, z));
      for (let k = 0; k < 8; k++) {
        dummy.position.set(
          x + (random() - 0.5) * (0.4 + h * 0.72),
          y + (random() - 0.53) * (0.3 + h * 0.48),
          z + (random() - 0.5) * (0.4 + h * 0.6),
        );
        dummy.rotation.set(0.35 + random() * 1.5, random() * Math.PI * 2, random() * 3);
        dummy.scale.setScalar(0.95 + random() * 0.95);
        dummy.updateMatrix();
        arborLeaves.push(dummy.matrix.clone());
      }
    }
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.032, 5, false),
      stemMaterial,
      canopy,
    );
  }
  const arbor = new THREE.InstancedMesh(leafGeometry, leafMaterial, arborLeaves.length);
  arborLeaves.forEach((m, i) => arbor.setMatrixAt(i, m));
  arbor.castShadow = arbor.receiveShadow = true;
  canopy.add(arbor);
  // Batch static joinery by surface while keeping walls pickable and each roof independently hideable.
  root.updateWorldMatrix(true, true);
  const oldGeometry = new Set<THREE.BufferGeometry>();
  function combine(target: THREE.Object3D, members: THREE.Object3D[]) {
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const inverse = target.matrixWorld.clone().invert();
    for (const member of members) {
      if (
        !(member instanceof THREE.Mesh) ||
        member instanceof THREE.InstancedMesh ||
        Array.isArray(member.material)
      )
        continue;
      const original = member.geometry as THREE.BufferGeometry;
      const geometry = original.index ? original.toNonIndexed() : original.clone();
      geometry.applyMatrix4(inverse.clone().multiply(member.matrixWorld));
      const batch = byMaterial.get(member.material) ?? [];
      batch.push(geometry);
      byMaterial.set(member.material, batch);
      member.removeFromParent();
      oldGeometry.add(original);
    }
    for (const [material, parts] of byMaterial) {
      const geometry = mergeGeometries(parts);
      if (geometry) mesh(geometry, material, target);
      for (const part of parts) part.dispose();
    }
  }
  const walls = new THREE.Group();
  root.add(walls);
  combine(
    walls,
    occluders.flatMap((wall) => [...wall.children]),
  );
  occluders.splice(0, occluders.length, walls, ...roofs);
  for (const roof of roofs) combine(roof, [...roof.children]);
  combine(root, [...root.children]);
  for (const geometry of oldGeometry) geometry.dispose();
  resources.capture(root);
  return {
    roofs,
    occluders,
    renderedObstacleIds,
    dispose() {
      attach.detach(root);
      root.removeFromParent();
      resources.dispose();
    },
  };
}
