import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { WorldObject } from '@elsewhere/character-interfaces';
import { createInitialWorld } from '../../server/src/world';
import { createEnvironmentMaterials } from './materials';
import { createScenePrimitives } from './scenePrimitives';
import { createCraftKit } from './craft';
import { ResourceScope } from './sceneResources';
import type { AttachWorldAsset } from './worldAssets';
import { createWorldObjectModel, WORLD_OBJECT_MODEL_DEFINITIONS } from './worldObjectModels';

function setup() {
  const scene = new THREE.Scene(),
    resources = new ResourceScope();
  const renderer = { capabilities: { getMaxAnisotropy: () => 4 } } as Pick<
    THREE.WebGLRenderer,
    'capabilities'
  >;
  const surfaces = createEnvironmentMaterials(renderer, {
    loader: { load: () => new THREE.Texture() } as Pick<THREE.TextureLoader, 'load'>,
  });
  const assets = Object.assign(vi.fn(), {
    detach: vi.fn(),
    dispose: vi.fn(),
    instances: vi.fn(),
    updateVisibility: vi.fn(),
  }) as unknown as AttachWorldAsset;
  const primitives = createScenePrimitives({ scene, resources, surfaces });
  return {
    scene,
    resources,
    surfaces,
    assets,
    primitives,
    craft: createCraftKit(surfaces, resources),
    dispose() {
      resources.dispose();
      surfaces.dispose();
    },
  };
}
function object(id: string, kind = id): WorldObject {
  return {
    id,
    kind,
    name: id,
    description: id,
    position: { x: 1, z: 2 },
    radius: 1,
    height: 0.5,
    color: '#ffffff',
    tags: [],
    affordances: ['inspect'],
  };
}

describe('world object model builders', () => {
  it('retains every existing model branch, its inspectable root and decorative selection ring', () => {
    const dependencies = setup();
    const examples = [
      object('bench'),
      object('workbench'),
      object('window'),
      object('mailbox'),
      object('garden'),
      object('artifact'),
      object('oak', 'tree'),
      object('water', 'pond'),
      object('shelf', 'bookshelf'),
      object('scope', 'telescope'),
      object('painting-kit'),
      object('magnifying-glass'),
      object('seed-library'),
      object('music-box'),
      object('launch-stand'),
      object('reckoning-bench'),
      object('instrument-shelter'),
      object('dispatch-wire'),
      object('sightings-ledger'),
      object('standing-stones'),
      object('windchime'),
      object('weather-station'),
      object('reading-table', 'table'),
      object('sundial'),
      object('future-object'),
    ];
    expect(
      new Set(
        examples.flatMap((value) =>
          WORLD_OBJECT_MODEL_DEFINITIONS.filter((definition) => definition.matches(value)).map(
            (definition) => definition.id,
          ),
        ),
      ).size,
    ).toBe(24);
    for (const value of examples) {
      const model = createWorldObjectModel(value, dependencies);
      dependencies.scene.add(model.root);
      expect(model.root.userData.objectId).toBe(value.id);
      expect(model.root.position.toArray()).toEqual([1, 0, 2]);
      expect(model.root.children.length).toBeGreaterThan(1);
      expect(model.selectionRing.userData.decorative).toBe(true);
      expect(model.selectionRing.visible).toBe(false);
      model.updateAmbient(1200, 3);
      model.dispose();
      model.dispose();
      expect(model.root.parent).toBeNull();
    }
    expect(dependencies.assets).toHaveBeenCalledWith(
      expect.any(THREE.Group),
      '/assets/polyhaven/models/rock_07/model-high.glb',
      expect.objectContaining({ height: 1.6 }),
    );
    // No authored object borrows a model from outside the world's own kit and scans.
    for (const [, path] of vi.mocked(dependencies.assets).mock.calls)
      expect(path).toMatch(/^\/assets\/polyhaven\//);
    dependencies.dispose();
  });

  it('stands every canonical object on the ground or on the surface beneath it', () => {
    const dependencies = setup(),
      world = createInitialWorld(1);
    for (const value of world.objects) {
      if (value.kind === 'tree' || value.kind === 'stones') continue; // scanned, loaded later
      const model = createWorldObjectModel(value, dependencies);
      model.selectionRing.removeFromParent();
      const base = new THREE.Box3().setFromObject(model.root).min.y;
      // Interior floorboards lie 5.5 cm above the terrain; nothing may hover beyond that.
      expect(Math.abs(base - (value.elevation ?? 0)), value.id).toBeLessThan(0.07);
      model.dispose();
    }
    // The artifact's resting height is the top of the workbench's display riser.
    const workbench = world.objects.find((value) => value.id === 'workbench')!,
      artifact = world.objects.find((value) => value.id === 'artifact')!;
    const bench = createWorldObjectModel(workbench, dependencies);
    bench.root.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(
      new THREE.Vector3(artifact.position.x, 5, artifact.position.z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(bench.root, true)[0];
    expect(hit?.point.y).toBeCloseTo(artifact.elevation!, 2);
    bench.dispose();
    dependencies.dispose();
  });

  it('uses the canonical garden footprint and keeps the artifact at its observed world height', () => {
    const dependencies = setup(),
      world = createInitialWorld(1);
    const garden = world.objects.find((value) => value.id === 'garden')!;
    const model = createWorldObjectModel(garden, dependencies);
    const bed = new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
    expect(bed.x).toBeCloseTo(garden.footprint!.maxX - garden.footprint!.minX);
    expect(bed.z).toBeCloseTo(garden.footprint!.maxZ - garden.footprint!.minZ);
    expect(bed.y).toBeGreaterThanOrEqual(garden.height);
    expect(bed.y).toBeLessThan(garden.height + 0.2);
    const artifact = world.objects.find((value) => value.id === 'artifact')!;
    const artifactModel = createWorldObjectModel(artifact, dependencies);
    const gem = artifactModel.root.children.find((child) => child.userData.separate)!;
    expect(gem.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(artifact.observationHeight!);
    model.dispose();
    artifactModel.dispose();
    dependencies.dispose();
  });

  it('accepts a focused model definition without changes to Scene or the default fallback', () => {
    const dependencies = setup();
    const model = createWorldObjectModel(object('extension'), dependencies, [
      {
        id: 'extension',
        matches: (value) => value.id === 'extension',
        build: ({ root, primitives }) => {
          primitives.box(0.2, 0.3, 0.4, 0xffffff, 0, 0, 0, root);
        },
      },
    ]);
    expect(
      (model.root.children[0] as THREE.Mesh<THREE.BoxGeometry>).geometry.parameters.height,
    ).toBe(0.3);
    model.dispose();
    dependencies.dispose();
  });
});
