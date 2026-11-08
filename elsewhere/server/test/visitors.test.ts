import { describe, expect, it } from 'vitest';
import {
  createInitialWorld,
  findPath,
  installWishFeature,
  isWalkable,
  observeWorld,
  upgradeWorldLayout,
} from '../src/world.js';
import { VisitorRegistry } from '../src/visitors.js';

describe('expanded explorable world', () => {
  it('preserves custom saved places, colliders, bounds and metadata during prototype expansion', () => {
    const saved = createInitialWorld(1000);
    delete saved.layoutVersion;
    delete saved.spatialVersion;
    saved.bounds = { minX: -40, maxX: 10, minZ: -8, maxZ: 8 };
    saved.places = saved.places.slice(0, 2);
    saved.obstacles = saved.obstacles.slice(0, 6);
    saved.places[0].description = 'A saved personal workshop.';
    saved.places.push({
      id: 'custom-clearing',
      name: 'My clearing',
      description: 'Saved custom place.',
      bounds: { minX: -39, maxX: -34, minZ: -5, maxZ: 5 },
      entryPoint: { x: -36, z: 0 },
    });
    saved.obstacles.push({
      id: 'custom-stone',
      minX: -38,
      maxX: -37,
      minZ: 2,
      maxZ: 3,
      height: 0.8,
      color: '#123',
    });
    Object.assign(saved.obstacles.at(-1)!, { ownerNote: 'Keep this stone.' });
    const customPlace = structuredClone(saved.places.at(-1)),
      customObstacle = structuredClone(saved.obstacles.at(-1));
    const upgraded = upgradeWorldLayout(saved);
    expect(upgraded.bounds).toEqual({ minX: -40, maxX: 32, minZ: -26, maxZ: 26 });
    expect(upgraded.places.find((place) => place.id === 'custom-clearing')).toEqual(customPlace);
    expect(upgraded.obstacles.find((obstacle) => obstacle.id === 'custom-stone')).toEqual(
      customObstacle,
    );
    expect(upgraded.places.find((place) => place.id === 'workshop')?.description).toBe(
      'A saved personal workshop.',
    );
    expect(saved.places).toHaveLength(3);
  });

  it('migrates only unchanged canonical spatial fields and retains customized same-ID geometry', () => {
    const saved = createInitialWorld(1000);
    delete saved.spatialVersion;
    for (const obstacle of saved.obstacles) {
      delete obstacle.shape;
      delete obstacle.sightApertures;
    }
    const garden = saved.objects.find((object) => object.id === 'garden')!;
    garden.position.x = 6;
    garden.height = 0.55;
    delete garden.footprint;
    delete garden.observationHeight;
    const artifact = saved.objects.find((object) => object.id === 'artifact')!;
    artifact.height = 0.5;
    delete artifact.elevation;
    delete artifact.observationHeight;
    artifact.detail = 'Saved personal discovery.';
    const pond = saved.objects.find((object) => object.id === 'pond-water')!;
    pond.radius = 5;
    delete pond.footprint;
    delete pond.observationHeight;
    const customWall = saved.obstacles.find((obstacle) => obstacle.id === 'workshop-west-wall')!;
    customWall.minX = -9.4;
    const upgraded = upgradeWorldLayout(saved);
    expect(upgraded.spatialVersion).toBe(1);
    expect(upgraded.objects.find((object) => object.id === 'garden')?.position.x).toBe(6.1);
    expect(upgraded.objects.find((object) => object.id === 'artifact')).toMatchObject({
      elevation: 1.19,
      height: 0.52,
      observationHeight: 1.45,
      detail: 'Saved personal discovery.',
    });
    expect(upgraded.objects.find((object) => object.id === 'pond-water')?.radius).toBe(4);
    expect(
      upgraded.obstacles.find((obstacle) => obstacle.id === 'pond-water-boundary')?.shape,
    ).toBe('ellipse');
    expect(upgraded.obstacles.find((obstacle) => obstacle.id === customWall.id)).toEqual(
      customWall,
    );
    expect(
      upgraded.obstacles.find((obstacle) => obstacle.id === 'workshop-door-north')?.sightApertures
        ?.length,
    ).toBeGreaterThan(0);
    expect(upgradeWorldLayout(upgraded)).toBe(upgraded);
  });
  it('offers navigable public destinations and physically blocks the pond', () => {
    const world = createInitialWorld(1000);
    expect(world.layoutVersion).toBe(3);
    expect(world.bounds.maxX - world.bounds.minX).toBe(64);
    for (const place of world.places) {
      expect(place.entryPoint).toBeTruthy();
      expect(isWalkable(world, place.entryPoint!)).toBe(true);
      expect(findPath(world, { x: 2, z: 3 }, place.entryPoint!)).not.toBeNull();
    }
    expect(isWalkable(world, { x: 20, z: 14 })).toBe(false);
    expect(observeWorld(world, 'hubert').knownPlaces?.map((place) => place.id)).toContain(
      'library',
    );
  });

  it('migrates earlier layouts while preserving creations and valid resident positions', () => {
    const saved = createInitialWorld(1000);
    delete saved.layoutVersion;
    saved.bounds = { minX: -10, maxX: 10, minZ: -8, maxZ: 8 };
    saved.objects = saved.objects.slice(0, 6);
    saved.places = saved.places.slice(0, 2);
    saved.obstacles = saved.obstacles.slice(0, 6);
    saved.objects[1].description = 'Hubert left a carefully revised sketch here.';
    saved.residents[0].path = [{ x: 100, z: 100 }];
    const upgraded = upgradeWorldLayout(saved);
    expect(upgraded.objects.find((object) => object.id === 'workbench')?.description).toContain(
      'revised sketch',
    );
    expect(upgraded.objects.some((object) => object.id === 'library-shelf')).toBe(true);
    expect(upgraded.residents[0].position).toEqual(saved.residents[0].position);
    expect(upgraded.residents[0].path).toEqual([]);
    expect(upgradeWorldLayout(upgraded)).toBe(upgraded);
  });

  it('only installs explicit owner feature presets and records a real world change', () => {
    const world = createInitialWorld(1000);
    expect(world.objects.some((object) => object.id === 'painting-kit')).toBe(false);
    const upgraded = installWishFeature(world, 'painting-kit', 2000);
    expect(upgraded.objects.find((object) => object.id === 'painting-kit')?.affordances).toContain(
      'inspect',
    );
    expect(upgraded.events.at(-1)?.type).toBe('feature_installed');
    expect(upgraded.version).toBeGreaterThan(world.version);
    expect(() => installWishFeature(upgraded, 'painting-kit', 3000)).toThrow('already installed');
    expect(() => installWishFeature(world, 'shell-tool', 2000)).toThrow('catalog');
    expect(() => installWishFeature(world, '__proto__', 2000)).toThrow('catalog');
  });
});

describe('visitor sessions have exploration authority only', () => {
  it('expires abandoned sessions even while public world polls advance their motion', () => {
    let now = 1000;
    const world = createInitialWorld(now),
      registry = new VisitorRegistry(() => now);
    const abandoned = registry.create(world),
      active = registry.create(world);
    now += 4 * 60_000;
    registry.get(active.visitorId, active.token, world);
    expect(registry.publicVisitors(world)).toHaveLength(2);
    now += 2 * 60_000;
    expect(registry.publicVisitors(world).map((visitor) => visitor.id)).toEqual([active.visitorId]);
    expect(() => registry.get(abandoned.visitorId, abandoned.token, world)).toThrow('unavailable');
    registry.get(active.visitorId, active.token, world);
    now += 4 * 60_000;
    expect(() => registry.authenticate(active.visitorId, active.token)).not.toThrow();
    now += 2 * 60_000;
    expect(() => registry.get(active.visitorId, active.token, world)).toThrow('unavailable');
  });

  it('rejects a six-millimetre corner crossing before it can teleport a visitor to spawn', () => {
    let now = 1000;
    const world = createInitialWorld(now),
      registry = new VisitorRegistry(() => now),
      visitor = registry.create(world);
    const from = { x: -0.5, z: -6.4 };
    registry.act(visitor.visitorId, visitor.token, { type: 'move', position: from }, world);
    now += 100000;
    expect(registry.get(visitor.visitorId, visitor.token, world).position).toEqual(from);
    expect(() =>
      registry.act(
        visitor.visitorId,
        visitor.token,
        { type: 'move', position: { x: -0.62, z: -6.51 } },
        world,
      ),
    ).toThrow('safely');
    now += 22;
    expect(registry.get(visitor.visitorId, visitor.token, world).position).toEqual(from);
  });

  it('stops an accepted segment when a new collider blocks its middle', () => {
    let now = 1000;
    const world = createInitialWorld(now),
      registry = new VisitorRegistry(() => now),
      visitor = registry.create(world);
    registry.act(
      visitor.visitorId,
      visitor.token,
      { type: 'move', position: { x: 8.2, z: 6.2 } },
      world,
    );
    world.obstacles.push({
      id: 'new-screen',
      minX: 7.59,
      maxX: 7.61,
      minZ: 6.59,
      maxZ: 6.61,
      height: 2,
    });
    now += 100;
    const stopped = registry.get(visitor.visitorId, visitor.token, world);
    expect(stopped.position).toEqual(visitor.position);
    expect(stopped.path).toEqual([]);
    expect(stopped.destination).toBeUndefined();
  });
  it('keeps credentials out of public visitors and isolates each session', () => {
    const world = createInitialWorld(1000);
    const registry = new VisitorRegistry(() => 1000);
    const first = registry.create(world);
    const second = registry.create(world);
    expect(first.visitorId).not.toBe(second.visitorId);
    expect(first.token).not.toBe(second.token);
    expect(() => registry.get(second.visitorId, first.token, world)).toThrow('unauthorized');
    expect(() => registry.get('hubert', first.token, world)).toThrow('unauthorized');
    const publicText = JSON.stringify(registry.publicVisitors(world));
    expect(publicText).not.toContain(first.token);
    expect(publicText).not.toContain(second.token);
    expect(publicText).not.toContain('"token"');
  });

  it('advances at a bounded speed and stops on request without changing Hubert', () => {
    let now = 1000;
    const world = createInitialWorld(now);
    const residentBefore = structuredClone(world.residents[0]);
    const registry = new VisitorRegistry(() => now);
    const visitor = registry.create(world);
    const moving = registry.act(
      visitor.visitorId,
      visitor.token,
      { type: 'move', position: { x: 14, z: 16 } },
      world,
    );
    expect(moving.path.length).toBeGreaterThan(1);
    expect(moving.position).toEqual(visitor.position);
    now += 1000;
    const advanced = registry.get(visitor.visitorId, visitor.token, world);
    expect(
      Math.hypot(
        advanced.position.x - visitor.position.x,
        advanced.position.z - visitor.position.z,
      ),
    ).toBeLessThanOrEqual(3.21);
    expect(advanced.position).not.toEqual(visitor.position);
    const stopped = registry.act(visitor.visitorId, visitor.token, { type: 'stop' }, world);
    now += 1000;
    expect(registry.get(visitor.visitorId, visitor.token, world).position).toEqual(
      stopped.position,
    );
    expect(world.residents[0]).toEqual(residentBefore);
  });

  it('rejects out-of-bounds positions, collisions, character actions and expired credentials', () => {
    let now = 1000;
    const world = createInitialWorld(now);
    const registry = new VisitorRegistry(() => now);
    const visitor = registry.create(world);
    for (const action of [
      { type: 'move', position: { x: 1000, z: 0 } },
      { type: 'move', position: { x: 20, z: 14 } },
      { type: 'work', targetId: 'workbench' },
      { type: 'delegate', task: 'start a worker' },
      { type: 'say', text: 'I control Hubert' },
      { type: 'look', facing: Number.NaN },
    ])
      expect(() => registry.act(visitor.visitorId, visitor.token, action, world)).toThrow();
    now += 30 * 60_000 + 1;
    expect(() => registry.get(visitor.visitorId, visitor.token, world)).toThrow('unavailable');
    expect(registry.publicVisitors(world)).toEqual([]);
  });

  it('moves diagonal keyboard steps directly while rejecting short steps through walls', () => {
    let now = 1000;
    const world = createInitialWorld(now);
    const registry = new VisitorRegistry(() => now);
    const visitor = registry.create(world);
    const direct = registry.act(
      visitor.visitorId,
      visitor.token,
      { type: 'move', position: { x: 8.2, z: 6.2 } },
      world,
    );
    expect(direct.path).toEqual([{ x: 8.2, z: 6.2 }]);
    now += 100;
    const diagonal = registry.get(visitor.visitorId, visitor.token, world);
    expect(diagonal.position.x).toBeGreaterThan(visitor.position.x);
    expect(diagonal.position.z).toBeLessThan(visitor.position.z);
    registry.act(
      visitor.visitorId,
      visitor.token,
      { type: 'move', position: { x: -0.5, z: -2 } },
      world,
    );
    now += 20000;
    const nearWall = registry.get(visitor.visitorId, visitor.token, world);
    expect(nearWall.position).toEqual({ x: -0.5, z: -2 });
    expect(() =>
      registry.act(
        visitor.visitorId,
        visitor.token,
        { type: 'move', position: { x: -1.8, z: -2 } },
        world,
      ),
    ).toThrow('safely');
    const longerRoute = registry.act(
      visitor.visitorId,
      visitor.token,
      { type: 'move', position: { x: -5, z: -2 } },
      world,
    );
    expect(
      longerRoute.path.some((position) => position.x === -1 && Math.abs(position.z) <= 1),
    ).toBe(true);
  });
});
