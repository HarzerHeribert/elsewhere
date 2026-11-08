import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createInitialWorld } from '../../server/src/world';
import { placeActorModel, resetActorPlacement } from './sceneActors';

describe('authoritative actor placement', () => {
  it('places the first snapshot inside its building immediately instead of freezing behind a wall', () => {
    const world = createInitialWorld(1),
      model = new THREE.Group();
    model.position.set(2, 0, 3);
    const target = { x: -6, z: -2 };
    placeActorModel(model, target, 0.016, world, [target]);
    expect(model.position.toArray()).toEqual([-6, 0, -2]);
    resetActorPlacement(model);
    placeActorModel(model, { x: 20, z: 2 }, 0.016, world);
    expect(model.position.toArray()).toEqual([20, 0, 2]);
  });

  it('continues checking collision after the initial authoritative placement', () => {
    const world = createInitialWorld(1),
      model = new THREE.Group();
    placeActorModel(model, { x: -6, z: -2 }, 0.016, world);
    const before = model.position.clone();
    placeActorModel(model, { x: -12, z: -2 }, 0.016, world);
    expect(model.position.toArray()).toEqual(before.toArray());
  });
});
