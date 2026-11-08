import { describe, expect, it } from 'vitest';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  findPath,
  isWalkable,
  observeWorld,
  publicWorld,
} from '../src/world.js';
import {
  hasLineOfSight,
  segmentIsWalkable,
  worldObjectObservationHeight,
} from '@elsewhere/character-interfaces';

describe('authoritative Elsewhere world', () => {
  it('validates continuous path connectors and stops an invalid saved corner segment', () => {
    const world = createInitialWorld(1000),
      from = { x: -0.5, z: -6.4 },
      to = { x: -0.62, z: -6.51 };
    expect(isWalkable(world, from)).toBe(true);
    expect(isWalkable(world, to)).toBe(true);
    expect(segmentIsWalkable(world, from, to)).toBe(false);
    const path = findPath(world, from, to)!;
    expect(path.length).toBeGreaterThan(1);
    let previous = from;
    for (const waypoint of path) {
      expect(segmentIsWalkable(world, previous, waypoint)).toBe(true);
      previous = waypoint;
    }
    const resident = world.residents[0];
    resident.position = from;
    resident.path = [to];
    resident.activity = 'walking';
    resident.destination = to;
    const advanced = advanceWorld(world, 1032);
    expect(advanced.residents[0].position).toEqual(from);
    expect(advanced.residents[0].path).toEqual([]);
    expect(advanced.events.at(-1)?.type).toBe('movement_blocked');
  });

  it('attaches reachable off-grid positions even when the nearest rounded node is blocked', () => {
    const world = createInitialWorld(1000),
      from = { x: 4.84, z: -3 },
      to = { x: 4, z: -3 };
    expect(isWalkable(world, from)).toBe(true);
    expect(isWalkable(world, { x: 5, z: -3 })).toBe(false);
    const path = findPath(world, from, to)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual(to);
    let previous = from;
    for (const waypoint of path) {
      expect(segmentIsWalkable(world, previous, waypoint)).toBe(true);
      previous = waypoint;
    }
  });

  it('shares rendered window apertures and physical observation anchors with sight', () => {
    const world = createInitialWorld(1000),
      resident = world.residents[0];
    resident.position = { x: -0.2, z: -5 };
    resident.facing = -Math.PI / 2;
    expect(observeWorld(world, resident.id).visibleObjects.map((object) => object.id)).toContain(
      'workbench',
    );
    expect(
      executeWorldCommand(world, resident.id, { type: 'look', targetId: 'workbench' }).outcome
        .status,
    ).toBe('completed');
    resident.eyeHeight = 0.6;
    expect(
      observeWorld(world, resident.id).visibleObjects.map((object) => object.id),
    ).not.toContain('workbench');
    resident.eyeHeight = 1.4;
    resident.position.z = -3;
    expect(
      observeWorld(world, resident.id).visibleObjects.map((object) => object.id),
    ).not.toContain('workbench');
    const artifact = world.objects.find((object) => object.id === 'artifact')!;
    expect(worldObjectObservationHeight(artifact)).toBe(1.45);
    expect(artifact.elevation! + artifact.height).toBeCloseTo(1.71);
    expect(world.objects.find((object) => object.id === 'garden')?.footprint).toEqual({
      minX: 5.1,
      maxX: 7.1,
      minZ: -4,
      maxZ: -2,
    });
  });

  it('does not sample past thin sight blockers or block dry corners outside circular water', () => {
    const world = createInitialWorld(1000);
    world.obstacles = [
      { id: 'thin-screen', minX: 0.041, maxX: 0.042, minZ: -0.1, maxZ: 0.1, height: 2 },
    ];
    expect(hasLineOfSight(world, { x: 0, z: 0 }, { x: 1, z: 0 })).toBe(false);
    const pond = createInitialWorld(1000);
    expect(isWalkable(pond, { x: 16.1, z: 10.1 })).toBe(true);
    expect(isWalkable(pond, { x: 20, z: 14 })).toBe(false);
    expect(segmentIsWalkable(pond, { x: 14, z: 14 }, { x: 26, z: 14 })).toBe(false);
  });
  it('routes through the workshop doorway rather than through walls', () => {
    const world = createInitialWorld(1000);
    const path = findPath(world, { x: 2, z: 3 }, { x: -6, z: -1 });
    expect(path).not.toBeNull();
    expect(path!.every((p) => isWalkable(world, p))).toBe(true);
    expect(path!.some((p) => p.x === -1 && p.z >= -1 && p.z <= 1)).toBe(true);
    expect(findPath(world, { x: 2, z: 3 }, { x: 200, z: 3 })).toBeNull();
    expect(findPath(world, { x: 2, z: 3 }, { x: 6, z: -3 })).toBeNull();
  });

  it('moves without a browser and records a verified arrival', () => {
    const initial = createInitialWorld(1000);
    const { world: moving, outcome } = executeWorldCommand(
      initial,
      'hubert',
      { type: 'move', targetId: 'workbench' },
      1000,
    );
    expect(outcome.status).toBe('started');
    expect(initial.residents[0].path).toEqual([]);
    const arrived = advanceWorld(moving, 31000);
    expect(arrived.residents[0].path).toEqual([]);
    expect(arrived.residents[0].position.x).toBeLessThan(-1);
    expect(arrived.events.at(-1)?.type).toBe('arrival');
    expect(observeWorld(arrived, 'hubert').placeId).toBe('workshop');
  });

  it('does not expose object details in observations or public scene metadata', () => {
    const world = createInitialWorld(1000);
    const observation = observeWorld(world, 'hubert');
    expect(observation.visibleObjects.every((o) => !('detail' in o))).toBe(true);
    expect(publicWorld(world).objects.every((o) => !('detail' in o))).toBe(true);
  });

  it('respects walls and field of view, then reveals detail only after approaching', () => {
    const world = createInitialWorld(1000);
    world.residents[0].position = { x: 2, z: -4 };
    world.residents[0].facing = -Math.PI / 2;
    expect(observeWorld(world, 'hubert').visibleObjects.some((o) => o.id === 'artifact')).toBe(
      false,
    );
    expect(
      executeWorldCommand(world, 'hubert', { type: 'inspect', targetId: 'artifact' }, 1000).outcome
        .status,
    ).toBe('rejected');
    const moving = executeWorldCommand(
      world,
      'hubert',
      { type: 'move', targetId: 'artifact' },
      1000,
    ).world;
    const arrived = advanceWorld(moving, 61000);
    const inspected = executeWorldCommand(
      arrived,
      'hubert',
      { type: 'inspect', targetId: 'artifact' },
      61000,
    );
    expect(inspected.outcome.status).toBe('completed');
    expect(inspected.outcome.evidence).toContain('hand-cranked weather vane');
  });

  it('rejects ambiguous movement, unauthorized residents, and unavailable delegation', () => {
    const world = createInitialWorld(1000);
    expect(executeWorldCommand(world, 'hubert', { type: 'move' }).outcome.status).toBe('rejected');
    expect(
      executeWorldCommand(world, 'hubert', {
        type: 'move',
        targetId: 'bench',
        position: { x: 0, z: 0 },
      }).outcome.status,
    ).toBe('rejected');
    expect(executeWorldCommand(world, 'intruder', { type: 'rest' }).outcome.status).toBe(
      'rejected',
    );
    expect(
      executeWorldCommand(world, 'hubert', { type: 'delegate', task: 'Run arbitrary code' }).outcome
        .status,
    ).toBe('rejected');
    expect(world.residents[0].activity).toBe('idle');
  });

  it('persists a concrete sketch object when work succeeds', () => {
    const initial = createInitialWorld(1000);
    const walking = executeWorldCommand(
      initial,
      'hubert',
      { type: 'move', targetId: 'workbench' },
      1000,
    ).world;
    const world = advanceWorld(walking, 61000);
    const worked = executeWorldCommand(
      world,
      'hubert',
      { type: 'work', targetId: 'workbench' },
      61000,
    );
    expect(worked.outcome.status).toBe('completed');
    expect(worked.world.objects.find((o) => o.id === 'weather-vane-sketch')?.detail).toContain(
      'Hypothesis:',
    );
    const restored = JSON.parse(JSON.stringify(worked.world));
    expect(
      restored.objects.find((o: { id: string }) => o.id === 'weather-vane-sketch'),
    ).toBeTruthy();
  });
});
