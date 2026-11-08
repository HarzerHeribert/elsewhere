import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { WorldObject } from '@elsewhere/character-interfaces';
import { createInitialWorld } from '../../server/src/world';
import { createEnvironmentMaterials } from './materials';
import { createScenePrimitives } from './scenePrimitives';
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
      object('standing-stones'),
      object('windchime'),
      object('weather-station'),
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
    ).toBe(17);
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
      '/assets/kenney/furniture/desk.glb',
      1.15,
      expect.any(THREE.Group),
    );
    dependencies.dispose();
  });

  it('uses the canonical garden footprint and keeps the artifact at its observed world height', () => {
    const dependencies = setup(),
      world = createInitialWorld(1);
    const garden = world.objects.find((value) => value.id === 'garden')!;
    const model = createWorldObjectModel(garden, dependencies);
    const bed = model.root.children[0] as THREE.Mesh<THREE.BoxGeometry>;
    expect(bed.geometry.parameters.width).toBe(garden.footprint!.maxX - garden.footprint!.minX);
    expect(bed.geometry.parameters.depth).toBe(garden.footprint!.maxZ - garden.footprint!.minZ);
    expect(bed.geometry.parameters.height).toBe(garden.height);
    const artifact = world.objects.find((value) => value.id === 'artifact')!;
    const artifactModel = createWorldObjectModel(artifact, dependencies);
    const gem = artifactModel.root.children[0]!;
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
