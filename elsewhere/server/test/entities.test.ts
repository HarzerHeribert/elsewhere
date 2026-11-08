import { describe, expect, it } from 'vitest';
import type { WorldEntity } from '@elsewhere/character-interfaces';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  observeWorld,
  publicWorld,
  upgradeWorldLayout,
} from '../src/world.js';

describe('world-owned living entities', () => {
  it('starts with three birds and a butterfly, distinct from static objects', () => {
    const world = createInitialWorld(1000);
    expect(world.layoutVersion).toBe(3);
    expect(world.entities?.filter((entity) => entity.kind === 'bird')).toHaveLength(3);
    expect(world.entities?.find((entity) => entity.id === 'garden-butterfly')?.tags).toEqual([
      'insects',
      'color',
      'patterns',
    ]);
    expect(
      world.objects.some((object) => world.entities?.some((entity) => entity.id === object.id)),
    ).toBe(false);
    expect(
      observeWorld(world, 'hubert').visibleEntities?.some(
        (entity) => entity.id === 'courtyard-sparrow',
      ),
    ).toBe(true);
  });

  it('moves and changes behavior deterministically from simulation time, with no model or viewer', () => {
    const initial = createInitialWorld(1000);
    const initialBird = initial.entities!.find((entity) => entity.id === 'courtyard-sparrow')!;
    expect(initialBird.behavior).toBe('foraging');
    const flying = advanceWorld(initial, 31000).entities!.find(
      (entity) => entity.id === initialBird.id,
    )!;
    expect(flying.behavior).toBe('flying');
    expect(flying.position).not.toEqual(initialBird.position);
    expect(flying.elevation).toBeGreaterThan(initialBird.elevation);
    const direct = advanceWorld(initial, 41000);
    expect(direct.entities!.find((entity) => entity.id === initialBird.id)?.behavior).toBe(
      'perched',
    );
    const stepped = advanceWorld(advanceWorld(initial, 21000), 41000);
    expect(stepped.entities).toEqual(direct.entities);
    expect(advanceWorld(direct, 41000).entities).toEqual(direct.entities);
    expect(advanceWorld(direct, 31000).entities).toEqual(direct.entities);
    expect(initial.entities!.find((entity) => entity.id === initialBird.id)).toEqual(initialBird);
  });

  it('keeps swimming and fluttering entities within their habitats', () => {
    const initial = createInitialWorld(1000);
    for (const elapsed of [0, 5000, 25000, 50000, 89000, 120000, 3600000]) {
      const world = advanceWorld(initial, 1000 + elapsed);
      const duck = world.entities!.find((entity) => entity.id === 'pond-duck')!;
      expect(duck.behavior).toBe('swimming');
      expect(duck.position.x).toBeGreaterThan(16);
      expect(duck.position.x).toBeLessThan(24);
      expect(duck.position.z).toBeGreaterThan(10);
      expect(duck.position.z).toBeLessThan(18);
      const butterfly = world.entities!.find((entity) => entity.id === 'garden-butterfly')!;
      expect(butterfly.position.x).toBeGreaterThan(4.8);
      expect(butterfly.position.x).toBeLessThan(7.2);
      expect(butterfly.position.z).toBeGreaterThan(-3.9);
      expect(butterfly.position.z).toBeLessThan(-2.1);
      expect(butterfly.elevation).toBeGreaterThan(0.7);
    }
  });

  it('requires actual visibility and records evidence linked to the authoritative event', () => {
    const world = createInitialWorld(1000);
    world.residents[0].facing = -Math.PI / 2;
    expect(
      observeWorld(world, 'hubert').visibleEntities?.some(
        (entity) => entity.id === 'courtyard-sparrow',
      ),
    ).toBe(false);
    const unseen = executeWorldCommand(
      world,
      'hubert',
      { type: 'inspect', targetId: 'courtyard-sparrow' },
      1000,
    );
    expect(unseen.outcome.status).toBe('rejected');
    expect(unseen.outcome.encounter).toBeUndefined();
    const looked = executeWorldCommand(
      world,
      'hubert',
      { type: 'look', targetId: 'courtyard-sparrow' },
      1000,
    );
    const watched = executeWorldCommand(
      looked.world,
      'hubert',
      { type: 'inspect', targetId: 'courtyard-sparrow' },
      1000,
    );
    const actual = watched.world.entities!.find((entity) => entity.id === 'courtyard-sparrow')!;
    expect(watched.outcome.status).toBe('completed');
    expect(watched.outcome.encounter).toEqual({
      entityId: actual.id,
      kind: actual.kind,
      species: actual.species,
      behavior: actual.behavior,
      observationVersion: actual.observationVersion,
      topics: actual.tags,
    });
    const evidence = JSON.parse(watched.outcome.evidence!);
    expect(evidence).toMatchObject({
      source: 'authoritative-world-entity',
      entityId: actual.id,
      observedAt: watched.world.updatedAt,
      behavior: actual.behavior,
      observationVersion: actual.observationVersion,
      position: actual.position,
    });
    expect(watched.world.events.find((event) => event.id === watched.outcome.id)).toMatchObject({
      type: 'entity_observed',
      entityId: actual.id,
      characterId: 'hubert',
    });
    expect(watched.outcome.objectId).toBeUndefined();
  });

  it('enforces watching distance, current existence, and non-controlling affordances', () => {
    const world = createInitialWorld(1000);
    world.residents[0].position = { x: -1.1, z: 6 };
    world.residents[0].facing = Math.PI / 2;
    expect(
      observeWorld(world, 'hubert').visibleEntities?.some(
        (entity) => entity.id === 'courtyard-sparrow',
      ),
    ).toBe(true);
    expect(
      executeWorldCommand(world, 'hubert', { type: 'inspect', targetId: 'courtyard-sparrow' }, 1000)
        .outcome.status,
    ).toBe('rejected');
    const close = createInitialWorld(1000);
    for (const type of ['interact', 'work'] as const) {
      const rejected = executeWorldCommand(
        close,
        'hubert',
        { type, targetId: 'courtyard-sparrow' },
        1000,
      );
      expect(rejected.outcome.status).toBe('rejected');
      expect(rejected.outcome.encounter).toBeUndefined();
    }
    const removed = structuredClone(close);
    removed.entities = removed.entities!.filter((entity) => entity.id !== 'courtyard-sparrow');
    expect(
      executeWorldCommand(
        removed,
        'hubert',
        { type: 'inspect', targetId: 'courtyard-sparrow' },
        1000,
      ).outcome.status,
    ).toBe('rejected');
    close.entities!.find((entity) => entity.id === 'courtyard-sparrow')!.affordances = [];
    expect(
      executeWorldCommand(close, 'hubert', { type: 'inspect', targetId: 'courtyard-sparrow' }, 1000)
        .outcome.status,
    ).toBe('rejected');
  });

  it('applies occlusion to arbitrary entity kinds and omits hidden metadata', () => {
    const world = createInitialWorld(1000);
    const entity: WorldEntity = {
      id: 'test-moth',
      name: 'A moth',
      kind: 'insect',
      description: 'A small moth.',
      position: { x: -0.1, z: -4.8 },
      radius: 0.1,
      height: 0.1,
      color: '#eee',
      tags: ['insects', 'patterns'],
      affordances: ['inspect'],
      behavior: 'flying',
      elevation: 0.8,
      facing: 0,
      observationVersion: 1,
      detail: 'private simulation metadata',
    };
    Object.assign(entity, { privateSeed: 'hidden seed' });
    world.entities = [entity];
    // This ray crosses the opaque part below the canonical window sill.
    world.residents[0].position = { x: -3, z: -5 };
    world.residents[0].eyeHeight = 0.8;
    world.residents[0].facing = Math.PI / 2;
    expect(observeWorld(world, 'hubert').visibleEntities).toEqual([]);
    expect(
      executeWorldCommand(world, 'hubert', { type: 'inspect', targetId: entity.id }, 1000).outcome
        .status,
    ).toBe('rejected');
    world.residents[0].position = { x: 1, z: -4.8 };
    world.residents[0].facing = -Math.PI / 2;
    const observation = observeWorld(world, 'hubert');
    expect(observation.visibleEntities).toHaveLength(1);
    expect(JSON.stringify(observation.visibleEntities)).not.toContain('private');
    expect(JSON.stringify(publicWorld(world).entities)).not.toContain('private');
    const observed = executeWorldCommand(
      world,
      'hubert',
      { type: 'inspect', targetId: entity.id },
      1000,
    );
    expect(observed.outcome.encounter?.kind).toBe('insect');
    expect(observed.outcome.encounter?.topics).toEqual(['insects', 'patterns']);
  });

  it('uses each resident’s actual eye height when low scenery hides creatures and objects', () => {
    const world = createInitialWorld(1000);
    const moth: WorldEntity = {
      id: 'low-moth',
      name: 'A low-flying moth',
      kind: 'insect',
      description: 'A moth beyond a hedge.',
      position: { x: 4, z: 0 },
      radius: 0.1,
      height: 0.1,
      color: '#ddd',
      tags: ['insects'],
      affordances: ['inspect'],
      behavior: 'flying',
      elevation: 0.75,
      facing: 0,
      observationVersion: 1,
    };
    world.entities = [moth];
    world.objects.push({
      id: 'low-marker',
      name: 'A little marker',
      kind: 'marker',
      description: 'A low marker beyond the hedge.',
      position: { x: 4, z: 0.4 },
      radius: 0.1,
      height: 0.8,
      color: '#eee',
      tags: ['patterns'],
      affordances: ['inspect'],
    });
    world.obstacles.push({
      id: 'low-hedge',
      minX: 1.8,
      maxX: 2.2,
      minZ: -0.8,
      maxZ: 0.8,
      height: 1,
    });
    const resident = world.residents[0];
    resident.position = { x: 0, z: 0 };
    resident.facing = Math.PI / 2;
    resident.eyeHeight = 0.78;
    expect(observeWorld(world, resident.id).visibleEntities).toEqual([]);
    expect(
      observeWorld(world, resident.id).visibleObjects.some((object) => object.id === 'low-marker'),
    ).toBe(false);
    expect(
      executeWorldCommand(world, resident.id, { type: 'inspect', targetId: moth.id }, 1000).outcome
        .status,
    ).toBe('rejected');
    resident.eyeHeight = 1.4;
    expect(observeWorld(world, resident.id).visibleEntities?.map((entity) => entity.id)).toContain(
      moth.id,
    );
    expect(
      observeWorld(world, resident.id).visibleObjects.some((object) => object.id === 'low-marker'),
    ).toBe(true);
    expect(
      executeWorldCommand(world, resident.id, { type: 'inspect', targetId: moth.id }, 1000).outcome
        .status,
    ).toBe('completed');
    expect(publicWorld(world).residents[0].eyeHeight).toBe(1.4);
  });

  it('finds a safe shore viewpoint instead of trying to walk onto a duck', () => {
    const world = createInitialWorld(1000);
    world.residents[0].position = { x: 14, z: 14 };
    world.residents[0].facing = Math.PI / 2;
    expect(
      observeWorld(world, 'hubert').visibleEntities?.some((entity) => entity.id === 'pond-duck'),
    ).toBe(true);
    const move = executeWorldCommand(
      world,
      'hubert',
      { type: 'move', targetId: 'pond-duck' },
      1000,
    );
    expect(move.outcome.status).toBe('started');
    const arrived = advanceWorld(move.world, 11000);
    const destination = arrived.residents[0].position;
    expect(
      destination.x < 15.75 ||
        destination.x > 24.25 ||
        destination.z < 9.75 ||
        destination.z > 18.25,
    ).toBe(true);
    const looked = executeWorldCommand(
      arrived,
      'hubert',
      { type: 'look', targetId: 'pond-duck' },
      11000,
    );
    const watched = executeWorldCommand(
      looked.world,
      'hubert',
      { type: 'inspect', targetId: 'pond-duck' },
      11000,
    );
    expect(watched.outcome.status).toBe('completed');
    expect(watched.outcome.encounter?.behavior).toBe('swimming');
  });

  it('migrates layout two without changing saved geometry, residents, or creations', () => {
    const saved = createInitialWorld(1000);
    saved.layoutVersion = 2;
    delete saved.entities;
    saved.objects[1].description = 'A saved creation survives here.';
    saved.residents[0].position = { x: -3, z: 0 };
    const geometry = JSON.stringify({
      bounds: saved.bounds,
      places: saved.places,
      obstacles: saved.obstacles,
    });
    const upgraded = upgradeWorldLayout(saved);
    expect(upgraded.layoutVersion).toBe(3);
    expect(upgraded.entities).toHaveLength(4);
    expect(
      JSON.stringify({
        bounds: upgraded.bounds,
        places: upgraded.places,
        obstacles: upgraded.obstacles,
      }),
    ).toBe(geometry);
    expect(upgraded.residents).toEqual(saved.residents);
    expect(upgraded.objects).toEqual(saved.objects);
    expect(upgraded.events.some((event) => event.id === saved.events[0].id)).toBe(true);
    expect(upgradeWorldLayout(upgraded)).toBe(upgraded);
  });
});
