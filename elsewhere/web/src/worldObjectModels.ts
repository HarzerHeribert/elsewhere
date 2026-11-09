import * as THREE from 'three';
import type { WorldObject } from '@elsewhere/character-interfaces';
import { WORLD_ASSETS, type AttachWorldAsset } from './worldAssets';
import { addTreeCrowns } from './treeCrowns';
import type { createEnvironmentMaterials } from './materials';
import { ResourceScope, releaseObjectResources } from './sceneResources';
import { decorative } from './scenePicking';
import { SCENE_COLORS as COLORS, type ScenePrimitives } from './scenePrimitives';

export interface WorldObjectModelDependencies {
  assets: AttachWorldAsset;
  surfaces: ReturnType<typeof createEnvironmentMaterials>;
  resources: ResourceScope;
  primitives: ScenePrimitives;
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
function buildBench(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box } = primitives;
  for (const zz of [-0.28, 0, 0.28]) box(2.25, 0.11, 0.22, COLORS.wood, 0, 0.62, zz, group);
  box(2.25, 0.58, 0.12, COLORS.wood, 0, 0.89, -0.43, group);
  for (const xx of [-0.85, 0.85]) {
    box(0.1, 0.65, 0.65, COLORS.forest, xx, 0, 0, group);
    box(0.1, 1.2, 0.1, COLORS.forest, xx, 0, -0.43, group);
  }
}

function buildWorkbench(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box, cylinder } = primitives;
  box(2.45, 0.16, 1.25, COLORS.wood, 0, 1.03, 0, group);
  for (const xx of [-0.95, 0.95])
    for (const zz of [-0.4, 0.4]) box(0.12, 1.05, 0.12, COLORS.forest, xx, 0, zz, group);
  box(0.7, 0.025, 0.45, COLORS.paper, 0.1, 1.2, 0.1, group);
  cylinder(0.12, 0.18, 0x638875, -0.75, 1.2, -0.2, group);
}

function buildWindow(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box } = primitives;
  box(0.15, 1.8, 1.65, COLORS.forest, 0, 0.9, 0, group);
  box(0.18, 0.09, 1.9, COLORS.wood, 0.05, 0.8, 0, group);
  box(0.18, 0.06, 1.8, COLORS.paper, 0.02, 1.8, 0, group);
  box(0.18, 1.8, 0.05, COLORS.paper, 0.02, 0.9, 0, group);
}

function buildMailbox(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box } = primitives;
  box(0.12, 1.2, 0.12, COLORS.wood, 0, 0, 0, group);
  box(0.8, 0.52, 0.65, COLORS.forest, 0, 1.1, 0, group);
  box(0.46, 0.035, 0.03, 0xe8d9b0, 0, 1.38, 0.337, group);
  box(0.06, 0.32, 0.05, 0xd99d69, 0.48, 1.32, 0, group);
  box(0.22, 0.15, 0.05, 0xd99d69, 0.55, 1.49, 0, group);
}

function buildGarden(context: WorldObjectBuildContext) {
  const { root: group, object, primitives, surfaces } = context;
  const { box } = primitives;
  const width = object.footprint ? object.footprint.maxX - object.footprint.minX : 2,
    depth = object.footprint ? object.footprint.maxZ - object.footprint.minZ : 2,
    bed = box(width, object.height, depth, COLORS.wood, 0, 0, 0, group);
  bed.material = surfaces.material('timber', {
    repeat: [width / 2, object.height / 2],
    normalStrength: 0.7,
  });
  box(width - 0.2, 0.03, depth - 0.2, 0x504b39, 0, object.height, 0, group);
}

function buildArtifact(context: WorldObjectBuildContext) {
  const { root: group, object, primitives } = context;
  const { material, cylinder } = primitives;
  const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), material(0xe3b86e));
  gem.position.y = (object.observationHeight ?? 1.45) - (object.elevation ?? 0);
  gem.rotation.set(0.2, 0.3, 0.4);
  group.add(gem);
  cylinder(0.23, 0.08, COLORS.forest, 0, 1.21 - (object.elevation ?? 0), 0, group);
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

function buildPond(context: WorldObjectBuildContext) {
  const { root: group, primitives, assets: attachAsset, ambient } = context;
  const { surface, sphere } = primitives;
  const { ripples } = ambient;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 0.06, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0x709b86,
      roughness: 0.17,
      metalness: 0,
      ior: 1.33,
      clearcoat: 0.8,
      clearcoatRoughness: 0.13,
      reflectivity: 0.45,
      envMapIntensity: 1.05,
      transparent: true,
      opacity: 0.9,
    }),
  );
  water.position.y = 0.06;
  water.receiveShadow = true;
  group.add(water);
  const shore = new THREE.Mesh(
    new THREE.RingGeometry(4.02, 4.75, 64),
    new THREE.MeshStandardMaterial({ color: 0xbab08d, roughness: 1, metalness: 0 }),
  );
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = 0.07;
  shore.receiveShadow = true;
  group.add(shore);
  surface(shore, 'path', 3, 3, 0xe2d7b7);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4,
      r = 4.15;
    const stone = new THREE.Group(),
      fallback = new THREE.Group();
    stone.position.set(Math.cos(a) * r, 0.025, Math.sin(a) * r);
    stone.rotation.y = a;
    group.add(stone);
    stone.add(fallback);
    sphere(0.35, 0xb6b89a, 0, 0.15, 0, fallback);
    attachAsset(stone, i % 2 ? WORLD_ASSETS.rock : WORLD_ASSETS.smallRock, 0.5, fallback);
  }
  for (let r = 0; r < 3; r++) {
    const ripple = new THREE.Mesh(
      new THREE.RingGeometry(0.7 + r * 0.6, 0.72 + r * 0.6, 48),
      new THREE.MeshBasicMaterial({
        color: 0xc7e5d5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.17,
        depthWrite: false,
      }),
    );
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(0.4, 0.105, -0.3);
    ripple.userData.phase = r;
    group.add(ripple);
    ripples.push(ripple);
  }
  for (const p of [
    [1.6, 1.2],
    [-1, -1.8],
    [2, -1.3],
  ]) {
    const lily = new THREE.Group();
    lily.position.set(p[0]!, 0.12, p[1]!);
    group.add(lily);
    attachAsset(lily, '/assets/kenney/nature/lily_large.glb', {
      height: 0.055,
      width: 0.65,
      depth: 0.65,
    });
  }
}

function buildBookshelf(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box } = primitives;
  box(3.7, 2.7, 0.65, COLORS.wood, 0, 0, 0, group);
  for (let row = 0; row < 3; row++) {
    box(3.5, 0.08, 0.72, COLORS.paper, 0, 0.6 + row * 0.85, 0, group);
    for (let n = 0; n < 12; n++)
      box(
        0.18,
        0.5 + (n % 3) * 0.06,
        0.45,
        [0x6d8265, 0xba896c, 0xd3bf8a, 0x8d9e9c][n % 4]!,
        n * 0.27 - 1.5,
        0.68 + row * 0.85,
        0.16,
        group,
      );
  }
}

function buildTelescope(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box, cylinder } = primitives;
  for (let i = 0; i < 3; i++) {
    const leg = box(
      0.07,
      1.4,
      0.07,
      COLORS.wood,
      Math.sin(i * 2.1) * 0.3,
      0,
      Math.cos(i * 2.1) * 0.3,
      group,
    );
    leg.rotation.z = Math.sin(i * 2.1) * 0.3;
  }
  const tube = cylinder(0.18, 1.3, COLORS.forest, 0, 1.2, 0, group);
  tube.rotation.z = 0.9;
}

function buildPaintingKit(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box, sphere } = primitives;
  for (const x of [-0.45, 0.45]) {
    const leg = box(0.08, 1.8, 0.08, COLORS.wood, x, 0, 0, group);
    leg.rotation.z = x * 0.2;
  }
  box(1.15, 1.0, 0.1, COLORS.wood, 0, 0.85, 0, group);
  box(1.0, 0.85, 0.04, COLORS.paper, 0, 0.93, 0.07, group);
  sphere(0.15, 0x8da678, -0.2, 1.35, 0.11, group);
  sphere(0.1, 0xcba264, 0.22, 1.2, 0.11, group);
}

function buildMagnifyingGlass(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { material, box, cylinder } = primitives;
  cylinder(0.3, 0.6, COLORS.wood, 0, 0, 0, group);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 24), material(0xb7a06e));
  ring.position.set(0, 1.2, 0);
  group.add(ring);
  box(0.07, 0.35, 0.07, COLORS.forest, 0, 0.6, 0, group);
}

function buildSeedLibrary(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box, sphere } = primitives;
  box(1.4, 1.1, 0.6, COLORS.wood, 0, 0, 0, group);
  for (let n = 0; n < 4; n++) {
    box(0.28, 0.5, 0.12, COLORS.paper, (n - 1.5) * 0.3, 0.5, 0.35, group);
    sphere(0.05, 0x839868, (n - 1.5) * 0.3, 0.8, 0.43, group);
  }
}

function buildMusicBox(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box, cylinder } = primitives;
  box(0.9, 0.55, 0.65, COLORS.wood, 0, 0, 0, group);
  box(1, 0.07, 0.75, 0xcbb886, 0, 0.55, 0, group);
  cylinder(0.18, 0.1, 0xb49b60, 0, 0.63, 0, group);
  box(0.25, 0.06, 0.06, 0xb49b60, 0.55, 0.3, 0, group);
}

function buildStones(context: WorldObjectBuildContext) {
  const { root: group, assets: attachAsset } = context;
  for (let i = 0; i < 3; i++) {
    const stone = new THREE.Group();
    stone.position.set((i - 1) * 0.85, 0, Math.sin(i) * 0.35);
    stone.rotation.y = i * 1.3;
    group.add(stone);
    attachAsset(stone, WORLD_ASSETS.rock, { height: 0.8 + i * 0.25 });
  }
}

function buildWindchime(context: WorldObjectBuildContext) {
  const { root: group, primitives, ambient } = context;
  const { box } = primitives;
  const { windParts } = ambient;
  box(0.1, 2.5, 0.1, COLORS.wood, 0, 0, 0, group);
  box(1.1, 0.1, 0.1, COLORS.wood, 0, 2.5, 0, group);
  for (let i = 0; i < 4; i++) {
    const chime = box(0.06, 0.5 + i * 0.13, 0.06, 0xc7ac78, (i - 1.5) * 0.23, 1.8, 0, group);
    chime.userData.phase = i;
    windParts.push(chime);
  }
}

function buildWeather(context: WorldObjectBuildContext) {
  const { root: group, primitives } = context;
  const { box } = primitives;
  box(0.12, 1.6, 0.12, COLORS.forest, 0, 0, 0, group);
  box(0.8, 0.1, 0.6, COLORS.paper, 0, 1.5, 0, group);
  box(0.06, 0.6, 0.06, COLORS.wood, 0, 1.6, 0, group);
  box(1.2, 0.04, 0.08, COLORS.forest, 0, 2.1, 0, group);
}

function buildFallback({ root: group, primitives: { cylinder, box } }: WorldObjectBuildContext) {
  cylinder(0.6, 0.65, 0xb6b89b, 0, 0, 0, group);
  box(0.05, 0.45, 0.05, COLORS.forest, 0, 0.65, 0, group);
}
/** Order preserves the established id/kind precedence, including custom object fallbacks. */
export const WORLD_OBJECT_MODEL_DEFINITIONS: readonly WorldObjectModelDefinition[] = [
  { id: 'bench', matches: ({ id, kind }) => kind === 'bench' || id === 'bench', build: buildBench },
  {
    id: 'workbench',
    matches: ({ id, kind }) => id === 'workbench' || kind === 'table',
    build: buildWorkbench,
  },
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
  { id: 'stones', matches: ({ id, kind }) => id.includes('stone'), build: buildStones },
  { id: 'windchime', matches: ({ id, kind }) => id === 'windchime', build: buildWindchime },
  { id: 'weather', matches: ({ id, kind }) => id.includes('weather'), build: buildWeather },
];

function attachFurnitureReplacement({
  object: { id, kind },
  root: group,
  assets: attachAsset,
}: WorldObjectBuildContext) {
  const replacement =
    id === 'bench' || kind === 'bench'
      ? { name: 'bench', height: 1.12 }
      : id === 'workbench'
        ? { name: 'desk', height: 1.15 }
        : kind === 'table'
          ? { name: 'table', height: 1.0 }
          : kind === 'bookshelf'
            ? { name: 'bookcaseOpen', height: 2.4 }
            : null;
  if (replacement) {
    const fallback = new THREE.Group();
    for (const child of [...group.children]) fallback.add(child);
    group.add(fallback);
    attachAsset(
      group,
      `/assets/kenney/furniture/${replacement.name}.glb`,
      replacement.height,
      fallback,
    );
  }
}

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
  attachFurnitureReplacement(context);
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
        (ripple.material as THREE.MeshBasicMaterial).opacity = 0.08 + wave * 0.09;
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
