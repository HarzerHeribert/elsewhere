import * as THREE from 'three';
import type { WorldObject } from '@elsewhere/character-interfaces';
import { WORLD_ASSETS, type AssetPlacement, type AttachWorldAsset } from './worldAssets';
import { addTreeCrowns } from './treeCrowns';
import type { createEnvironmentMaterials } from './materials';
import { ResourceScope, releaseObjectResources } from './sceneResources';
import { decorative } from './scenePicking';
import type { ScenePrimitives } from './scenePrimitives';
import { separate, type CraftKit } from './craft';
import { createWaterSurface } from './water';
import { WORLD_PALETTE as P, WORLD_SCALE } from './worldStyle';

export interface WorldObjectModelDependencies {
  assets: AttachWorldAsset;
  surfaces: ReturnType<typeof createEnvironmentMaterials>;
  resources: ResourceScope;
  primitives: ScenePrimitives;
  craft: CraftKit;
}
export interface WorldObjectBuildContext extends WorldObjectModelDependencies {
  object: WorldObject;
  root: THREE.Group;
  ambient: { windParts: THREE.Mesh[]; ripples: THREE.Mesh[] };
}
/** Add a definition to extend world objects without adding rendering branches to Scene. */
export interface WorldObjectModelDefinition {
  id: string;
  matches(object: WorldObject): boolean;
  build(context: WorldObjectBuildContext): void;
}
export interface WorldObjectModel {
  root: THREE.Group;
  selectionRing: THREE.Mesh;
  updateAmbient(worldTime: number, wind: number): void;
  dispose(): void;
}

// Every model below is built from the craft kit: the shared timber scan in a few tones,
// the four paints, brass, iron and glass, at the human scale in WORLD_SCALE.

/** A slatted garden bench facing +z. */
function buildBench({ root: g, craft: k }: WorldObjectBuildContext) {
  const slat = k.wood('oak'),
    frame = k.paint(P.forest, 0.6),
    seat = WORLD_SCALE.seat;
  for (let i = 0; i < 4; i++)
    k.box(g, slat, 1.7, 0.03, 0.09, 0, seat - 0.03, -0.17 + i * 0.113, { grain: 'x' });
  for (const [y, lean] of [
    [0.6, -0.235],
    [0.73, -0.255],
    [0.86, -0.275],
  ] as const) {
    const back = k.box(g, slat, 1.7, 0.095, 0.028, 0, y, lean, { grain: 'x' });
    back.rotation.x = -0.14;
  }
  for (const x of [-0.72, 0.72]) {
    k.box(g, frame, 0.05, seat - 0.03, 0.05, x, 0, 0.19);
    const rear = k.box(g, frame, 0.05, 0.98, 0.05, x, 0, -0.25);
    rear.rotation.x = -0.07;
    k.box(g, frame, 0.05, 0.04, 0.46, x, seat - 0.07, -0.02);
    k.box(g, frame, 0.05, 0.2, 0.05, x, seat, 0.19);
    k.box(g, slat, 0.07, 0.028, 0.5, x, seat + 0.2, -0.02, { grain: 'z' });
  }
}

/** A long joiner's bench. Its far end carries the riser that the artifact rests on. */
function buildWorkbench({ root: g, craft: k }: WorldObjectBuildContext) {
  const top = WORLD_SCALE.workTop,
    oak = k.wood('oak'),
    walnut = k.wood('walnut');
  k.box(g, oak, 3.1, 0.07, 0.82, 0.3, top - 0.07, 0, { grain: 'x', radius: 0.015 });
  for (const x of [-1.15, 0.3, 1.75])
    for (const z of [-0.33, 0.33])
      k.box(g, walnut, 0.09, top - 0.07, 0.09, x, 0, z, { grain: 'y' });
  for (const z of [-0.33, 0.33]) k.box(g, walnut, 2.9, 0.07, 0.045, 0.3, 0.2, z, { grain: 'x' });
  k.box(g, oak, 2.9, 0.03, 0.62, 0.3, 0.27, 0, { grain: 'x' });
  k.crate(g, -0.55, 0, 0.1).position.y = 0.3;
  // The display riser: a small drawer chest whose top is the artifact's resting height.
  k.box(g, walnut, 0.5, 0.24, 0.36, 1.5, top, 0, { radius: 0.02 });
  for (const y of [0.03, 0.13]) {
    k.box(g, oak, 0.42, 0.085, 0.01, 1.5, top + y, 0.181, { grain: 'x', radius: 0.004 });
    k.ball(g, k.metal(), 0.013, 1.5, top + y + 0.042, 0.195);
  }
  // A vice, the plans being worked on, a mug and the wireless.
  k.box(g, k.metal(P.iron, 0.55), 0.16, 0.11, 0.1, -0.95, top - 0.09, 0.46, { radius: 0.01 });
  k.strut(
    g,
    k.metal(P.iron, 0.55),
    [-0.95, top - 0.035, 0.5],
    [-0.95, top - 0.035, 0.66],
    0.012,
    8,
  );
  const plan = k.box(g, k.paint(P.paper, 0.9), 0.42, 0.004, 0.3, 0.1, top, 0.08, { radius: 0 });
  plan.rotation.y = 0.18;
  plan.castShadow = false;
  k.strut(g, k.paint(P.clay), [0.3, top + 0.008, 0.2], [0.42, top + 0.008, 0.02], 0.006, 6);
  k.rod(g, k.paint(P.mint, 0.5), 0.038, 0.085, -0.25, top, -0.22, { sides: 16 });
  k.radio(g, -0.75, top, -0.2, 0.25);
}

/** The window seat: an armchair on a rug, turned to the workshop's south-west window. */
function buildWindow({ root, craft: k, object }: WorldObjectBuildContext) {
  const g = new THREE.Group();
  g.rotation.y = Math.atan2(-9 - object.position.x, 3.9 - object.position.z);
  root.add(g);
  const oak = k.wood('oak'),
    walnut = k.wood('walnut'),
    seat = WORLD_SCALE.seat;
  for (const [radius, color, lift] of [
    [0.95, P.linen, 0],
    [0.7, P.mint, 0.002],
    [0.4, P.cream, 0.004],
  ] as const)
    k.rod(g, k.paint(color, 1), radius, 0.012 + lift, 0, 0.055, 0.05, { sides: 36 }).castShadow =
      false;
  for (const x of [-0.25, 0.25]) {
    k.box(g, walnut, 0.045, seat + 0.2, 0.045, x, 0.06, 0.22, { grain: 'y' });
    const rear = k.box(g, walnut, 0.045, 0.98, 0.045, x, 0.06, -0.23, { grain: 'y' });
    rear.rotation.x = -0.06;
    k.box(g, oak, 0.06, 0.026, 0.52, x, seat + 0.26, 0, { grain: 'z' });
  }
  k.box(g, oak, 0.54, 0.04, 0.5, 0, seat - 0.02, 0, { grain: 'x' });
  k.box(g, k.paint(P.clay, 0.95), 0.46, 0.085, 0.44, 0, seat + 0.02, 0.01, { radius: 0.035 });
  for (const y of [0.78, 0.94]) k.box(g, oak, 0.5, 0.09, 0.026, 0, y, -0.26, { grain: 'x' });
  const cushion = k.box(g, k.paint(P.mint, 0.95), 0.42, 0.34, 0.07, 0, seat + 0.1, -0.2, {
    radius: 0.03,
  });
  cushion.rotation.x = -0.1;
  // A side table with something to read while the weather goes by.
  k.rod(g, walnut, 0.022, 0.5, 0.62, 0.06, 0.12, { sides: 10 });
  k.rod(g, walnut, 0.14, 0.02, 0.62, 0.06, 0.12, { sides: 18 });
  k.rod(g, oak, 0.22, 0.026, 0.62, 0.56, 0.12, { sides: 24 });
  k.bookStack(g, 0.6, 0.586, 0.1, 2);
  k.rod(g, k.paint(P.cream, 0.5), 0.034, 0.075, 0.7, 0.586, 0.22, { sides: 14 });
}

function buildMailbox({ root: g, craft: k }: WorldObjectBuildContext) {
  const green = k.paint(P.forest, 0.55),
    brass = k.metal();
  k.box(g, k.wood('walnut'), 0.085, 1.02, 0.085, 0, 0, 0, { grain: 'y' });
  k.box(g, k.wood('walnut'), 0.3, 0.03, 0.5, 0, 1.0, 0, { grain: 'z' });
  k.box(g, green, 0.24, 0.13, 0.44, 0, 1.03, 0, { radius: 0.006 });
  const arch = k.solid(
    g,
    green,
    new THREE.CylinderGeometry(0.12, 0.12, 0.44, 18, 1, false, -Math.PI / 2, Math.PI),
    0,
    1.16,
    0,
  );
  arch.rotation.x = -Math.PI / 2;
  k.box(g, k.paint(P.cream, 0.7), 0.17, 0.035, 0.006, 0, 1.19, 0.221, { radius: 0 });
  k.ball(g, brass, 0.014, 0, 1.11, 0.228);
  k.box(g, brass, 0.012, 0.19, 0.028, 0.127, 1.1, 0.08, { radius: 0 });
  k.box(g, k.paint(P.clay, 0.6), 0.012, 0.07, 0.1, 0.127, 1.26, 0.044, { radius: 0 });
}

/** A boarded raised bed with dark soil; gardens.ts plants it. */
function buildGarden({ root: g, object, craft: k }: WorldObjectBuildContext) {
  const width = object.footprint ? object.footprint.maxX - object.footprint.minX : 2,
    depth = object.footprint ? object.footprint.maxZ - object.footprint.minZ : 2,
    h = object.height,
    board = k.wood('weathered');
  for (const side of [-1, 1]) {
    k.box(g, board, width, h + 0.03, 0.06, 0, 0, side * (depth / 2 - 0.03), { grain: 'x' });
    k.box(g, board, 0.06, h + 0.03, depth - 0.12, side * (width / 2 - 0.03), 0, 0, { grain: 'z' });
    for (const end of [-1, 1])
      k.box(
        g,
        k.wood('walnut'),
        0.1,
        h + 0.07,
        0.1,
        side * (width / 2 - 0.05),
        0,
        end * (depth / 2 - 0.05),
        {
          grain: 'y',
        },
      );
  }
  k.box(g, k.paint(P.soil, 1), width - 0.12, 0.05, depth - 0.12, 0, h - 0.05, 0, { radius: 0 });
}

/** A faceted keepsake in a brass cradle. Its base is the object's own elevation. */
function buildArtifact({ root: g, object, craft: k }: WorldObjectBuildContext) {
  const centre = Math.max(0.24, (object.observationHeight ?? 1.45) - (object.elevation ?? 0)),
    brass = k.metal();
  k.rod(g, k.wood('walnut'), 0.12, 0.025, 0, 0, 0, { sides: 20 });
  const ring = k.solid(g, brass, new THREE.TorusGeometry(0.075, 0.009, 8, 20), 0, 0.03, 0);
  ring.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.4;
    k.strut(
      g,
      brass,
      [Math.cos(a) * 0.075, 0.03, Math.sin(a) * 0.075],
      [Math.cos(a) * 0.1, centre - 0.02, Math.sin(a) * 0.1],
      0.006,
      6,
    );
  }
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.14, 0),
    new THREE.MeshPhysicalMaterial({
      color: P.gem,
      emissive: P.gem,
      emissiveIntensity: 0.45,
      roughness: 0.12,
      clearcoat: 1,
      flatShading: true,
    }),
  );
  gem.scale.y = 1.3;
  gem.position.y = centre;
  gem.rotation.y = 0.5;
  gem.castShadow = true;
  g.add(separate(gem));
}

function buildTree(context: WorldObjectBuildContext) {
  const { root: group, assets: attachAsset } = context;
  const wrapper = new THREE.Group();
  group.add(wrapper);
  const height = 3.5 * 1.3;
  addTreeCrowns(wrapper, [{ x: 0, y: 0, z: 0, height }], context.surfaces, true);
  attachAsset(wrapper, WORLD_ASSETS.tree, { height, anchorXZ: 'origin', maxDistance: 34 });
  attachAsset(wrapper, WORLD_ASSETS.treeLow, {
    height,
    anchorXZ: 'origin',
    minDistance: 34,
    shadow: false,
  });
}

/** Still water with a gravel shore, scanned stones and lily pads resting on the surface. */
function buildPond(context: WorldObjectBuildContext) {
  const { root: group, primitives, assets: attachAsset, ambient, craft: k } = context;
  const water = createWaterSurface(new THREE.CylinderGeometry(4, 4, 0.06, 64));
  water.position.y = 0.06;
  group.add(separate(water));
  const bed = new THREE.Mesh(new THREE.CircleGeometry(4, 48), k.paint(0x2c4a40, 1));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.045;
  group.add(bed);
  const shore = new THREE.Mesh(
    new THREE.RingGeometry(3.96, 4.75, 64),
    new THREE.MeshStandardMaterial({ color: 0xbab08d, roughness: 1, metalness: 0 }),
  );
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = 0.07;
  shore.receiveShadow = true;
  group.add(separate(shore));
  primitives.surface(shore, 'path', 3, 3, 0xe2d7b7);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4,
      r = 4.2;
    const stone = new THREE.Group();
    stone.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    stone.rotation.y = a;
    group.add(stone);
    scannedStone(attachAsset, stone, { height: 0.34 + (i % 3) * 0.09 }, 12);
  }
  for (let r = 0; r < 3; r++) {
    const ripple = new THREE.Mesh(
      new THREE.RingGeometry(0.7 + r * 0.6, 0.72 + r * 0.6, 48),
      new THREE.MeshBasicMaterial({
        color: 0xd7efe4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    );
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(0.4, 0.105, -0.3);
    ripple.userData.phase = r;
    group.add(separate(ripple));
    ambient.ripples.push(ripple);
  }
  const pad = k.paint(P.leaf, 0.55),
    petal = k.paint(P.blossom, 0.6);
  for (const [x, z, size, turn, flower] of [
    [1.6, 1.2, 0.3, 0.4, true],
    [1.95, 0.85, 0.2, 2.1, false],
    [-1, -1.8, 0.27, 3.3, true],
    [-1.4, -1.5, 0.19, 5, false],
    [2, -1.3, 0.24, 1.2, false],
    [-2.3, 1.6, 0.26, 4.2, true],
  ] as const) {
    const leaf = k.solid(
      group,
      pad,
      new THREE.CircleGeometry(size, 16, 0.3, Math.PI * 2 - 0.6),
      x,
      0.096,
      z,
    );
    leaf.rotation.set(-Math.PI / 2, 0, turn);
    leaf.castShadow = false;
    if (!flower) continue;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tip = k.solid(group, petal, new THREE.ConeGeometry(0.022, 0.085, 5), 0, 0, 0);
      tip.position.set(x + Math.cos(a) * 0.035, 0.125, z + Math.sin(a) * 0.035);
      tip.rotation.set(Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75);
    }
    k.ball(group, k.paint(P.buttercup, 0.6), 0.018, x, 0.12, z);
  }
}
/** A double-sided library stack, loaded on both faces. */
function buildBookshelf({ root: g, craft: k }: WorldObjectBuildContext) {
  k.bookcase(g, 3.2, 2.15, 0.34).position.z = 0.17;
  const reverse = k.bookcase(g, 3.2, 2.15, 0.34);
  reverse.position.z = -0.17;
  reverse.rotation.y = Math.PI;
}

/** A reading table with work left open on it. */
function buildTable({ root: g, craft: k }: WorldObjectBuildContext) {
  const top = WORLD_SCALE.table,
    oak = k.wood('oak'),
    walnut = k.wood('walnut');
  k.box(g, oak, 1.75, 0.045, 0.95, 0, top - 0.045, 0, { grain: 'x', radius: 0.014 });
  for (const x of [-0.76, 0.76])
    for (const z of [-0.38, 0.38])
      k.box(g, walnut, 0.07, top - 0.045, 0.07, x, 0, z, { grain: 'y' });
  for (const z of [-0.38, 0.38])
    k.box(g, walnut, 1.45, 0.09, 0.028, 0, top - 0.135, z, { grain: 'x' });
  for (const x of [-0.76, 0.76])
    k.box(g, walnut, 0.028, 0.09, 0.7, x, top - 0.135, 0, { grain: 'z' });
  k.bookStack(g, 0.45, top, -0.12, 3);
  for (const side of [-1, 1]) {
    const page = k.box(g, k.paint(P.paper, 0.9), 0.15, 0.012, 0.22, -0.3 + side * 0.076, top, 0.1, {
      radius: 0.003,
    });
    page.rotation.z = side * 0.07;
  }
  k.box(g, k.paint(P.forest, 0.8), 0.32, 0.006, 0.23, -0.3, top, 0.1, { radius: 0 });
}

/** A brass refractor on a wooden tripod. */
function buildTelescope({ root: g, craft: k }: WorldObjectBuildContext) {
  const brass = k.metal(),
    walnut = k.wood('walnut'),
    head = 1.15;
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.5;
    k.strut(g, walnut, [0, head, 0], [Math.sin(a) * 0.46, 0, Math.cos(a) * 0.46], 0.022);
    k.strut(
      g,
      k.metal(P.iron, 0.6),
      [Math.sin(a) * 0.2, head * 0.565, Math.cos(a) * 0.2],
      [0, head * 0.5, 0],
      0.006,
      5,
    );
  }
  k.ball(g, brass, 0.05, 0, head, 0);
  k.strut(g, brass, [-0.42, head - 0.09, 0], [0.5, head + 0.4, 0], 0.06, 16);
  k.strut(g, brass, [0.44, head + 0.368, 0], [0.58, head + 0.443, 0], 0.074, 16);
  k.strut(g, k.metal(P.iron, 0.5), [-0.55, head - 0.16, 0], [-0.42, head - 0.09, 0], 0.032, 12);
}

/** A field easel with a canvas in progress and a paint box at its foot. */
function buildPaintingKit({ root: g, craft: k }: WorldObjectBuildContext) {
  const oak = k.wood('oak');
  for (const x of [-0.32, 0.32]) k.strut(g, oak, [x, 0, 0.14], [x * 0.2, 1.5, -0.04], 0.018);
  k.strut(g, oak, [0, 0, -0.5], [0, 1.44, -0.05], 0.018);
  k.box(g, oak, 0.66, 0.03, 0.07, 0, 0.7, 0.1, { grain: 'x' });
  const canvas = new THREE.Group();
  canvas.position.set(0, 0.73, 0.085);
  canvas.rotation.x = -0.1;
  g.add(canvas);
  k.box(canvas, k.paint(P.paper, 0.95), 0.56, 0.44, 0.022, 0, 0, 0, { radius: 0.004 });
  for (const [x, y, w, h, color] of [
    [0, 0.03, 0.5, 0.15, P.mint],
    [-0.08, 0.17, 0.3, 0.1, P.leaf],
    [0.13, 0.26, 0.11, 0.11, P.buttercup],
  ] as const)
    k.box(canvas, k.paint(color, 0.9), w, h, 0.003, x, y, 0.0125, { radius: 0 });
  k.box(g, k.wood('walnut'), 0.32, 0.07, 0.22, 0.52, 0, 0.22, { radius: 0.01 });
  for (const [i, color] of [P.clay, P.buttercup, P.mint, P.forest].entries())
    k.rod(g, k.paint(color, 0.5), 0.022, 0.012, 0.42 + i * 0.065, 0.07, 0.22, { sides: 10 });
}

/** A hand lens standing in its block on a small plinth. */
function buildMagnifyingGlass({ root: g, craft: k }: WorldObjectBuildContext) {
  k.box(g, k.wood('oak'), 0.3, 0.52, 0.3, 0, 0, 0, { grain: 'y', radius: 0.02 });
  k.box(g, k.wood('walnut'), 0.36, 0.03, 0.36, 0, 0.52, 0);
  k.strut(g, k.wood('walnut'), [-0.02, 0.55, 0], [0.04, 0.72, 0], 0.014);
  k.solid(g, k.metal(), new THREE.TorusGeometry(0.09, 0.011, 8, 28), 0.07, 0.81, 0);
  k.solid(g, k.glass(), new THREE.CircleGeometry(0.09, 24), 0.07, 0.81, 0).castShadow = false;
}

/** A glazed seed cabinet on a post, like a small free library. */
function buildSeedLibrary({ root: g, craft: k }: WorldObjectBuildContext) {
  const walnut = k.wood('walnut');
  k.box(g, walnut, 0.09, 0.95, 0.09, 0, 0, 0, { grain: 'y' });
  k.box(g, k.wood('oak'), 0.64, 0.5, 0.3, 0, 0.95, 0, { radius: 0.012 });
  k.box(g, k.paint(P.soil, 1), 0.54, 0.4, 0.01, 0, 1.0, 0.147, { radius: 0 });
  k.box(g, k.wood('oak'), 0.54, 0.018, 0.04, 0, 1.19, 0.14, { grain: 'x' });
  for (let i = 0; i < 8; i++) {
    const x = ((i % 4) - 1.5) * 0.125,
      y = 1.01 + Math.floor(i / 4) * 0.2;
    k.box(g, k.paint(P.paper, 0.9), 0.095, 0.14, 0.008, x, y, 0.155, { radius: 0 });
    k.box(
      g,
      k.paint([P.leaf, P.poppy, P.buttercup, P.mint][i % 4]!, 0.8),
      0.06,
      0.05,
      0.003,
      x,
      y + 0.07,
      0.16,
      {
        radius: 0,
      },
    );
  }
  k.box(g, k.glass(), 0.54, 0.4, 0.006, 0, 1.0, 0.172, { radius: 0 }).castShadow = false;
  for (const side of [-1, 1]) {
    const slope = k.box(g, k.paint(P.forest, 0.6), 0.42, 0.028, 0.4, side * 0.17, 1.52, 0, {
      radius: 0.004,
    });
    slope.rotation.z = -side * 0.5;
  }
  k.ball(g, k.metal(), 0.014, 0.24, 1.2, 0.18);
}

/** A cylinder music box, lid open, on a three-legged stool. */
function buildMusicBox({ root: g, craft: k }: WorldObjectBuildContext) {
  const brass = k.metal(),
    walnut = k.wood('walnut'),
    top = 0.44;
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094;
    k.strut(
      g,
      walnut,
      [Math.sin(a) * 0.1, top - 0.03, Math.cos(a) * 0.1],
      [Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2],
      0.018,
    );
  }
  k.rod(g, k.wood('oak'), 0.2, 0.035, 0, top - 0.035, 0, { sides: 24 });
  k.box(g, walnut, 0.3, 0.12, 0.2, 0, top, 0, { radius: 0.014 });
  k.box(g, k.paint(P.clay, 0.95), 0.26, 0.004, 0.16, 0, top + 0.12, 0, { radius: 0 });
  const drum = k.rod(g, brass, 0.028, 0.2, 0, 0, 0, { sides: 14 });
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0, top + 0.135, 0);
  const lid = new THREE.Group();
  lid.position.set(0, top + 0.12, -0.1);
  lid.rotation.x = -1.15;
  g.add(lid);
  k.box(lid, k.wood('oak'), 0.3, 0.02, 0.2, 0, 0, 0.1, { radius: 0.006 });
  k.strut(g, brass, [0.15, top + 0.06, 0], [0.2, top + 0.06, 0], 0.006, 6);
  k.strut(g, brass, [0.2, top + 0.06, 0], [0.2, top + 0.11, 0], 0.006, 6);
  k.ball(g, brass, 0.013, 0.2, top + 0.115, 0);
}

/** Three scanned stones, set upright in a loose arc. */
function buildStones({ root: g, assets: attachAsset }: WorldObjectBuildContext) {
  for (const [x, z, height, width, turn] of [
    [-0.85, 0.1, 1.15, 0.62, 0.3],
    [0, -0.25, 1.6, 0.74, 1.9],
    [0.85, 0.15, 1.3, 0.66, 3.4],
  ] as const) {
    const stone = new THREE.Group();
    stone.position.set(x, -0.06, z);
    stone.rotation.y = turn;
    g.add(stone);
    scannedStone(attachAsset, stone, { height, width, depth: width * 0.7 }, 26);
  }
}

/** Brass tubes under a wooden striker, hung from a bracketed post. */
function buildWindchime({ root: g, craft: k, ambient }: WorldObjectBuildContext) {
  const walnut = k.wood('walnut'),
    brass = k.metal(P.brass, 0.3),
    hang = 2.02;
  k.box(g, walnut, 0.09, 2.3, 0.09, 0, 0, 0, { grain: 'y' });
  k.box(g, walnut, 0.82, 0.06, 0.06, 0.37, 2.18, 0, { grain: 'x' });
  k.strut(g, walnut, [0, 1.85, 0], [0.42, 2.19, 0], 0.022);
  k.strut(g, k.metal(P.iron, 0.6), [0.6, 2.18, 0], [0.6, hang, 0], 0.004, 5);
  k.rod(g, k.wood('oak'), 0.12, 0.022, 0.6, hang - 0.022, 0, { sides: 20 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2,
      length = 0.3 + i * 0.055;
    const tube = new THREE.CylinderGeometry(0.011, 0.011, length, 10);
    tube.translate(0, -length / 2 - 0.07, 0);
    const chime = separate(new THREE.Mesh(tube, brass));
    chime.position.set(0.6 + Math.cos(a) * 0.085, hang - 0.02, Math.sin(a) * 0.085);
    chime.castShadow = true;
    chime.userData.phase = i;
    g.add(chime);
    ambient.windParts.push(chime);
  }
  const sail = new THREE.BoxGeometry(0.075, 0.12, 0.006);
  sail.translate(0, -0.66, 0);
  const catcher = separate(new THREE.Mesh(sail, k.wood('oak')));
  catcher.position.set(0.6, hang - 0.02, 0);
  catcher.userData.phase = 7;
  g.add(catcher);
  ambient.windParts.push(catcher);
}

/** A weather post: a brass vane over the compass arms, cups and a louvred screen. */
function buildWeather({ root: g, craft: k, object }: WorldObjectBuildContext) {
  const top = object.height > 2 ? 2.15 : 1.5,
    brass = k.metal(),
    iron = k.metal(P.iron, 0.6);
  k.box(g, k.wood('walnut'), 0.085, top, 0.085, 0, 0, 0, { grain: 'y' });
  k.box(g, k.paint(P.cream, 0.8), 0.26, 0.3, 0.22, 0, top * 0.5, 0.15, { radius: 0.01 });
  for (let i = 0; i < 4; i++)
    k.box(g, k.paint(P.linen, 0.9), 0.24, 0.012, 0.03, 0, top * 0.5 + 0.045 + i * 0.065, 0.262, {
      radius: 0,
    });
  k.box(g, k.paint(P.forest, 0.6), 0.32, 0.025, 0.28, 0, top * 0.5 + 0.3, 0.15, { radius: 0.004 });
  k.rod(g, iron, 0.009, 0.42, 0, top, 0, { sides: 6 });
  for (const [x, z] of [
    [0.22, 0],
    [0, 0.22],
  ] as const) {
    k.strut(g, iron, [-x, top + 0.12, -z], [x, top + 0.12, z], 0.006, 5);
    for (const side of [-1, 1]) k.ball(g, brass, 0.018, side * x, top + 0.12, side * z);
  }
  const vane = new THREE.Group();
  vane.position.y = top + 0.4;
  vane.rotation.y = 0.65;
  g.add(vane);
  k.strut(vane, brass, [-0.3, 0, 0], [0.28, 0, 0], 0.008, 6);
  const head = k.solid(vane, brass, new THREE.ConeGeometry(0.04, 0.11, 8), 0.32, 0, 0);
  head.rotation.z = -Math.PI / 2;
  k.box(vane, brass, 0.15, 0.1, 0.006, -0.3, -0.05, 0, { radius: 0 });
  k.ball(vane, brass, 0.022, 0, 0, 0);
  k.strut(g, iron, [0, top - 0.3, 0], [0, top - 0.3, -0.3], 0.007, 5);
  k.rod(g, iron, 0.006, 0.1, 0, top - 0.3, -0.3, { sides: 5 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094;
    k.strut(
      g,
      iron,
      [0, top - 0.2, -0.3],
      [Math.cos(a) * 0.1, top - 0.2, -0.3 + Math.sin(a) * 0.1],
      0.004,
      4,
    );
    k.ball(g, k.paint(P.mint, 0.5), 0.032, Math.cos(a) * 0.1, top - 0.2, -0.3 + Math.sin(a) * 0.1);
  }
}

/** A stone pedestal with a brass dial and gnomon. */
function buildSundial({ root: g, craft: k }: WorldObjectBuildContext) {
  const stone = k.stone(),
    brass = k.metal(P.brass, 0.58);
  k.rod(g, stone, 0.24, 0.12, 0, 0, 0, { sides: 8 });
  k.rod(g, stone, 0.14, 0.56, 0, 0.12, 0, { top: 0.115, sides: 8 });
  k.rod(g, stone, 0.25, 0.07, 0, 0.68, 0, { top: 0.27, sides: 8 });
  k.rod(g, brass, 0.21, 0.012, 0, 0.75, 0, { sides: 32 });
  const blade = new THREE.Shape();
  blade.moveTo(-0.13, 0);
  blade.lineTo(0.12, 0);
  blade.lineTo(0.12, 0.15);
  blade.closePath();
  const gnomon = k.solid(
    g,
    brass,
    new THREE.ExtrudeGeometry(blade, { depth: 0.008, bevelEnabled: false }),
    0,
    0.762,
    0,
  );
  gnomon.rotation.y = 0.9;
  for (let hour = 0; hour < 12; hour++) {
    const a = (hour / 12) * Math.PI * 2;
    const tick = k.box(
      g,
      k.metal(P.iron, 0.6),
      0.03,
      0.003,
      0.008,
      Math.cos(a) * 0.18,
      0.762,
      Math.sin(a) * 0.18,
      {
        radius: 0,
      },
    );
    tick.rotation.y = -a;
  }
}

/** Anything unrecognised still belongs to the world: a stone plinth with a brass plate. */
/** A low wooden tripod holding a clear bottle rocket, nose up and slightly tilted. */
/** A slate-topped bench with chalk, a slide rule and a brass arithmometer. */
function buildReckoningBench({ root: g, craft: k }: WorldObjectBuildContext) {
  const walnut = k.wood('walnut'),
    top = WORLD_SCALE.workTop;
  k.box(g, walnut, 1.2, 0.05, 0.6, 0, top - 0.05, 0, { grain: 'x', radius: 0.01 });
  k.box(g, k.stone(), 1.1, 0.025, 0.5, 0, top, 0, { radius: 0.005, tile: 2 });
  for (const x of [-0.5, 0.5])
    for (const z of [-0.22, 0.22])
      k.box(g, walnut, 0.07, top - 0.05, 0.07, x, 0, z, { grain: 'y' });
  k.box(g, k.paint(P.cream, 0.6), 0.3, 0.012, 0.05, -0.2, top + 0.025, 0.15, { radius: 0.003 });
  k.box(g, k.metal(), 0.28, 0.07, 0.16, 0.3, top + 0.025, -0.08, { radius: 0.01 });
}

/** A Stevenson screen on a post: white louvred box, a rain gauge beside it. */
function buildInstrumentShelter({ root: g, craft: k }: WorldObjectBuildContext) {
  const white = k.paint(P.cream, 0.8),
    iron = k.metal(P.iron, 0.6);
  for (const [x, z] of [
    [-0.3, -0.25],
    [0.3, -0.25],
    [-0.3, 0.25],
    [0.3, 0.25],
  ] as const)
    k.box(g, k.wood('walnut'), 0.06, 1.0, 0.06, x, 0, z, { grain: 'y' });
  k.box(g, white, 0.76, 0.05, 0.64, 0, 1.0, 0, { radius: 0.005 });
  for (let i = 0; i < 6; i++)
    k.box(g, white, 0.7, 0.012, 0.58, 0, 1.06 + i * 0.045, 0, { radius: 0 });
  k.box(g, white, 0.74, 0.05, 0.62, 0, 1.34, 0, { radius: 0.005 });
  k.box(g, white, 0.02, 0.28, 0.58, -0.36, 1.05, 0, { radius: 0 });
  k.box(g, white, 0.02, 0.28, 0.58, 0.36, 1.05, 0, { radius: 0 });
  k.rod(g, k.metal(), 0.045, 0.3, 0.7, 0, 0, { sides: 14 });
  k.rod(g, iron, 0.052, 0.02, 0.7, 0.3, 0, { sides: 14 });
}

/** The ticker-tape telegraph under a glass dome, on a small table. */
function buildDispatchWire({ root: g, craft: k }: WorldObjectBuildContext) {
  const walnut = k.wood('walnut'),
    brass = k.metal();
  for (const [x, z] of [
    [-0.22, -0.22],
    [0.22, -0.22],
    [-0.22, 0.22],
    [0.22, 0.22],
  ] as const)
    k.box(g, walnut, 0.05, 0.62, 0.05, x, 0, z, { grain: 'y' });
  k.box(g, walnut, 0.56, 0.05, 0.56, 0, 0.62, 0, { grain: 'x', radius: 0.01 });
  k.box(g, brass, 0.3, 0.07, 0.2, 0, 0.67, 0, { radius: 0.01 });
  k.rod(g, brass, 0.07, 0.03, -0.1, 0.74, 0, { sides: 16 });
  k.rod(g, k.paint(P.cream, 0.8), 0.06, 0.04, -0.1, 0.77, 0, { sides: 16 });
  k.box(g, k.paint(P.linen, 0.9), 0.2, 0.004, 0.025, 0.14, 0.75, 0.05, { radius: 0 });
  k.solid(
    g,
    k.glass(),
    new THREE.SphereGeometry(0.28, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    0,
    0.67,
    0,
  );
}

/** A weatherproof ledger on a post, under a small pitched cover. */
function buildSightingsLedger({ root: g, craft: k }: WorldObjectBuildContext) {
  const walnut = k.wood('walnut');
  k.box(g, walnut, 0.09, 1.0, 0.09, 0, 0, 0, { grain: 'y' });
  k.box(g, walnut, 0.5, 0.04, 0.38, 0, 1.0, 0, { grain: 'x', radius: 0.008 });
  k.box(g, k.paint(P.forest, 0.7), 0.42, 0.04, 0.3, 0, 1.04, 0, { radius: 0.01 });
  k.box(g, k.paint(P.cream, 0.8), 0.38, 0.015, 0.26, 0, 1.08, 0, { radius: 0.002 });
  k.box(g, k.glass(), 0.46, 0.012, 0.34, 0, 1.18, 0, { radius: 0.002 });
  for (const [x, z] of [
    [-0.22, -0.16],
    [0.22, -0.16],
    [-0.22, 0.16],
    [0.22, 0.16],
  ] as const)
    k.box(g, walnut, 0.02, 0.12, 0.02, x, 1.06, z, { grain: 'y' });
}

/** A low stone ring of a well with two posts, a crossbar, a windlass drum and a bucket. */
function buildWishingWell({ root: g, craft: k }: WorldObjectBuildContext) {
  const oak = k.wood('walnut');
  k.rod(g, k.stone(), 0.8, 0.75, 0, 0, 0, { sides: 24 });
  k.solid(g, k.stone(), new THREE.TorusGeometry(0.72, 0.1, 8, 24), 0, 0.75, 0).rotation.x =
    Math.PI / 2;
  k.rod(g, k.paint(P.forest, 0.2), 0.62, 0.02, 0, 0.74, 0, { sides: 24 });
  for (const x of [-0.72, 0.72]) k.box(g, oak, 0.1, 1.6, 0.1, x, 0, 0, { grain: 'y' });
  k.box(g, oak, 1.56, 0.1, 0.1, 0, 1.5, 0, { grain: 'x' });
  // The windlass drum, 20 cm across, lies along the crossbar; the bucket hangs below it.
  k.solid(g, oak, new THREE.CylinderGeometry(0.1, 0.1, 1.3, 12), 0, 1.25, 0).rotation.z =
    Math.PI / 2;
  k.rod(g, oak, 0.1, 0.18, 0.0, 0.8, 0, { sides: 12 });
}

function buildLaunchStand({ root: g, craft: k }: WorldObjectBuildContext) {
  const walnut = k.wood('walnut'),
    head = 0.62;
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.3;
    k.strut(g, walnut, [0, head, 0], [Math.sin(a) * 0.42, 0, Math.cos(a) * 0.42], 0.022);
  }
  const bottle = new THREE.Group();
  bottle.position.set(0, head - 0.1, 0);
  bottle.rotation.z = -0.22;
  g.add(bottle);
  k.rod(bottle, k.glass(), 0.1, 0.34, 0, 0, 0, { sides: 18 });
  k.rod(bottle, k.paint(P.mint, 0.6), 0.1, 0.12, 0, 0.0, 0, { sides: 18 });
  k.solid(bottle, k.paint(P.poppy, 0.7), new THREE.ConeGeometry(0.1, 0.2, 18), 0, 0.44, 0);
  k.rod(bottle, k.paint(P.buttercup, 0.6), 0.035, 0.1, 0, 0.34, 0, { sides: 12 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094;
    k.box(
      bottle,
      k.paint(P.poppy, 0.7),
      0.012,
      0.12,
      0.08,
      Math.sin(a) * 0.1,
      -0.02,
      Math.cos(a) * 0.1,
      {
        radius: 0,
      },
    );
  }
}

function buildFallback({ root: g, craft: k }: WorldObjectBuildContext) {
  k.box(g, k.stone(), 0.46, 0.5, 0.46, 0, 0, 0, { radius: 0.04, tile: 2 });
  k.box(g, k.stone(), 0.56, 0.07, 0.56, 0, 0.5, 0, { radius: 0.025, tile: 2 });
  k.box(g, k.metal(), 0.3, 0.008, 0.2, 0, 0.57, 0, { radius: 0 });
}
/** A scanned stone: the full scan close by, the lighter model from further off. */
function scannedStone(
  attachAsset: AttachWorldAsset,
  parent: THREE.Object3D,
  placement: AssetPlacement,
  near: number,
) {
  attachAsset(parent, WORLD_ASSETS.rock, { ...placement, maxDistance: near });
  attachAsset(parent, WORLD_ASSETS.rockLow, { ...placement, minDistance: near });
}

/** Order preserves the established id/kind precedence, including custom object fallbacks. */
export const WORLD_OBJECT_MODEL_DEFINITIONS: readonly WorldObjectModelDefinition[] = [
  { id: 'bench', matches: ({ id, kind }) => kind === 'bench' || id === 'bench', build: buildBench },
  {
    id: 'workbench',
    matches: ({ id, kind }) => id === 'workbench' || kind === 'workbench',
    build: buildWorkbench,
  },
  { id: 'table', matches: ({ kind }) => kind === 'table', build: buildTable },
  { id: 'window', matches: ({ id, kind }) => id === 'window', build: buildWindow },
  { id: 'mailbox', matches: ({ id, kind }) => id === 'mailbox', build: buildMailbox },
  { id: 'garden', matches: ({ id, kind }) => id === 'garden', build: buildGarden },
  { id: 'artifact', matches: ({ id, kind }) => id === 'artifact', build: buildArtifact },
  { id: 'tree', matches: ({ id, kind }) => kind === 'tree', build: buildTree },
  { id: 'pond', matches: ({ id, kind }) => kind === 'pond', build: buildPond },
  { id: 'bookshelf', matches: ({ id, kind }) => kind === 'bookshelf', build: buildBookshelf },
  { id: 'telescope', matches: ({ id, kind }) => kind === 'telescope', build: buildTelescope },
  {
    id: 'paintingKit',
    matches: ({ id, kind }) => id === 'painting-kit' || kind === 'painting-kit',
    build: buildPaintingKit,
  },
  {
    id: 'magnifyingGlass',
    matches: ({ id, kind }) => id === 'magnifying-glass' || kind === 'magnifying-glass',
    build: buildMagnifyingGlass,
  },
  {
    id: 'seedLibrary',
    matches: ({ id, kind }) => id === 'seed-library' || kind === 'seed-library',
    build: buildSeedLibrary,
  },
  {
    id: 'musicBox',
    matches: ({ id, kind }) => id === 'music-box' || kind === 'music-box',
    build: buildMusicBox,
  },
  {
    id: 'reckoningBench',
    matches: ({ id, kind }) => id === 'reckoning-bench' || kind === 'reckoning-bench',
    build: buildReckoningBench,
  },
  {
    id: 'instrumentShelter',
    matches: ({ id, kind }) => id === 'instrument-shelter' || kind === 'instrument-shelter',
    build: buildInstrumentShelter,
  },
  {
    id: 'dispatchWire',
    matches: ({ id, kind }) => id === 'dispatch-wire' || kind === 'dispatch-wire',
    build: buildDispatchWire,
  },
  {
    id: 'sightingsLedger',
    matches: ({ id, kind }) => id === 'sightings-ledger' || kind === 'sightings-ledger',
    build: buildSightingsLedger,
  },
  {
    id: 'wishingWell',
    matches: ({ id, kind }) => id === 'wishing-well' || kind === 'wishing-well',
    build: buildWishingWell,
  },
  {
    id: 'launchStand',
    matches: ({ id, kind }) => id === 'launch-stand' || kind === 'launch-stand',
    build: buildLaunchStand,
  },
  {
    id: 'sundial',
    matches: ({ id, kind }) => kind === 'sundial' || id === 'sundial',
    build: buildSundial,
  },
  { id: 'stones', matches: ({ id, kind }) => id.includes('stone'), build: buildStones },
  { id: 'windchime', matches: ({ id, kind }) => id === 'windchime', build: buildWindchime },
  { id: 'weather', matches: ({ id, kind }) => id.includes('weather'), build: buildWeather },
];

export function createWorldObjectModel(
  object: WorldObject,
  dependencies: WorldObjectModelDependencies,
  definitions: readonly WorldObjectModelDefinition[] = WORLD_OBJECT_MODEL_DEFINITIONS,
): WorldObjectModel {
  const group = new THREE.Group();
  group.position.set(object.position.x, object.elevation ?? 0, object.position.z);
  group.userData.objectId = object.id;
  const ambient = { windParts: [] as THREE.Mesh[], ripples: [] as THREE.Mesh[] };
  const context = { ...dependencies, object, root: group, ambient };
  const definition = definitions.find((candidate) => candidate.matches(object));
  (definition?.build ?? buildFallback)(context);
  // Built-in models bake to one mesh per material; extension definitions keep their own parts.
  if (definitions === WORLD_OBJECT_MODEL_DEFINITIONS) dependencies.craft.merge(group);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 0.85, 32),
    new THREE.MeshBasicMaterial({
      color: 0xf3d78c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.name = 'selectionRing';
  ring.visible = false;
  ring.position.y = 0.09 - (object.elevation ?? 0);
  group.add(decorative(ring));

  dependencies.resources.capture(group);
  let disposed = false;
  return {
    root: group,
    selectionRing: ring,
    updateAmbient(worldTime, wind) {
      for (const chime of ambient.windParts)
        chime.rotation.z = Math.sin(worldTime * 0.0014 + chime.userData.phase) * wind * 0.018;
      for (const ripple of ambient.ripples) {
        const wave = (Math.sin(worldTime * 0.0007 + ripple.userData.phase) + 1) / 2;
        ripple.scale.setScalar(0.9 + wave * 0.2);
        (ripple.material as THREE.MeshBasicMaterial).opacity = 0.03 + wave * 0.06;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      dependencies.assets.detach(group);
      releaseObjectResources(group);
      group.removeFromParent();
      ambient.windParts.length = ambient.ripples.length = 0;
    },
  };
}
