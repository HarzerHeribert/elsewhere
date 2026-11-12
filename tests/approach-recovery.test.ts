import { describe, expect, it } from 'vitest';
import type { WorldState } from '@elsewhere/character-interfaces';
import { segmentIsWalkable } from '@elsewhere/character-interfaces';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  findPath,
  isWalkable,
  observeWorld,
  upgradeWorldLayout,
} from '../elsewhere/server/src/world';

function fixture(): WorldState {
  const world = createInitialWorld(0);
  world.bounds = { minX: -10, maxX: 10, minZ: -8, maxZ: 8 };
  world.obstacles = [];
  world.objects = [
    {
      id: 'object',
      name: 'The object',
      kind: 'object',
      position: { x: 0, z: 0 },
      radius: 1,
      height: 1,
      color: '#fff',
      description: 'A small mechanism.',
      tags: [],
      affordances: ['inspect'],
      detail: 'A copper fin is bent.',
    },
  ];
  world.entities = [];
  world.residents = [
    {
      id: 'hubert',
      ownerId: 'owner',
      name: 'Hubert',
      position: { x: 0, z: 4 },
      facing: 0,
      path: [],
      activity: 'idle',
    },
  ];
  return world;
}
function assertSafePath(world: WorldState) {
  let from = world.residents[0].position;
  for (const to of world.residents[0].path) {
    expect(segmentIsWalkable(world, from, to)).toBe(true);
    from = to;
  }
}

describe('object approaches', () => {
  it('chooses another reachable side when the nearest walkable approach point is enclosed', () => {
    const world = fixture();
    world.obstacles = [
      { id: 'top', minX: -1, maxX: 1, minZ: 2.4, maxZ: 2.7, height: 2 },
      { id: 'bottom', minX: -1, maxX: 1, minZ: 0.5, maxZ: 0.8, height: 2 },
      { id: 'left', minX: -1.3, maxX: -1, minZ: 0.5, maxZ: 2.7, height: 2 },
      { id: 'right', minX: 1, maxX: 1.3, minZ: 0.5, maxZ: 2.7, height: 2 },
    ];
    const from = world.residents[0].position,
      nearest = { x: 0, z: 1.6 };
    expect(isWalkable(world, nearest)).toBe(true);
    expect(findPath(world, from, nearest)).toBeNull();
    expect(findPath(world, from, { x: 1.6, z: 0 })).not.toBeNull();
    const moved = executeWorldCommand(world, 'hubert', { type: 'move', targetId: 'object' }, 0);
    expect(moved.outcome.status).toBe('started');
    expect(moved.world.residents[0].destination).not.toEqual(nearest);
    assertSafePath(moved.world);
    const arrived = advanceWorld(moved.world, 60_000);
    expect(arrived.residents[0].path).toEqual([]);
    expect(observeWorld(arrived, 'hubert').visibleObjects.some((o) => o.id === 'object')).toBe(
      true,
    );
    expect(
      executeWorldCommand(arrived, 'hubert', { type: 'inspect', targetId: 'object' }, 60_000)
        .outcome.status,
    ).toBe('completed');
  });
  it('avoids reachable approach positions with an obstructed view of the target', () => {
    const world = fixture();
    world.obstacles = [{ id: 'screen', minX: -0.7, maxX: 0.7, minZ: 0.5, maxZ: 0.8, height: 2 }];
    expect(findPath(world, world.residents[0].position, { x: 0, z: 1.6 })).not.toBeNull();
    const moved = executeWorldCommand(world, 'hubert', { type: 'move', targetId: 'object' }, 0);
    expect(moved.outcome.status).toBe('started');
    expect(moved.world.residents[0].destination).not.toEqual({ x: 0, z: 1.6 });
    assertSafePath(moved.world);
    const arrived = advanceWorld(moved.world, 60_000);
    expect(
      executeWorldCommand(arrived, 'hubert', { type: 'inspect', targetId: 'object' }, 60_000)
        .outcome.status,
    ).toBe('completed');
  });
  it('rejects an enclosed target when every viewing approach is unreachable without moving the resident', () => {
    const world = fixture();
    world.obstacles = [
      { id: 'top', minX: -2.3, maxX: 2.3, minZ: 2, maxZ: 2.3, height: 2 },
      { id: 'bottom', minX: -2.3, maxX: 2.3, minZ: -2.3, maxZ: -2, height: 2 },
      { id: 'left', minX: -2.3, maxX: -2, minZ: -2, maxZ: 2, height: 2 },
      { id: 'right', minX: 2, maxX: 2.3, minZ: -2, maxZ: 2, height: 2 },
    ];
    const before = structuredClone(world);
    const moved = executeWorldCommand(world, 'hubert', { type: 'move', targetId: 'object' }, 0);
    expect(moved.outcome.status).toBe('rejected');
    expect(moved.world.residents[0].position).toEqual(world.residents[0].position);
    expect(moved.world.residents[0].path).toEqual([]);
    expect(world).toEqual(before);
  });
  it('faces an object after arrival instead of leaving it behind the resident’s viewing direction', () => {
    const world = fixture();
    // A valid saved route can finish with its last leg pointing away from its object.
    world.residents[0].position = { x: 0, z: 1.1 };
    world.residents[0].path = [{ x: 0, z: 1.6 }];
    world.residents[0].destination = { x: 0, z: 1.6 };
    world.residents[0].gazeTargetId = 'object';
    world.residents[0].activity = 'walking';
    assertSafePath(world);
    const arrived = advanceWorld(world, 60_000);
    const resident = arrived.residents[0];
    const expectedFacing = Math.atan2(0 - resident.position.x, 0 - resident.position.z);
    expect(Math.cos(resident.facing - expectedFacing)).toBeCloseTo(1);
    expect(observeWorld(arrived, 'hubert').visibleObjects.some((o) => o.id === 'object')).toBe(
      true,
    );
  });
  it('turns toward a nearby object on a no-op move without inventing travel or moving through a collider', () => {
    const world = fixture();
    world.residents[0].position = { x: 0, z: 2 };
    world.residents[0].facing = 0;
    expect(observeWorld(world, 'hubert').visibleObjects.some((o) => o.id === 'object')).toBe(false);
    const moved = executeWorldCommand(world, 'hubert', { type: 'move', targetId: 'object' }, 0);
    expect(moved.outcome.status).toBe('completed');
    expect(moved.world.residents[0].position).toEqual(world.residents[0].position);
    expect(moved.world.residents[0].path).toEqual([]);
    expect(observeWorld(moved.world, 'hubert').visibleObjects.some((o) => o.id === 'object')).toBe(
      true,
    );
    expect(
      executeWorldCommand(moved.world, 'hubert', { type: 'inspect', targetId: 'object' }, 0).outcome
        .status,
    ).toBe('completed');
  });
});

it('migrates exact old policy-laden object text without replacing customized content or source history', () => {
  const world = createInitialWorld(0);
  const shelf = world.objects.find((o) => o.id === 'library-shelf')!;
  shelf.detail =
    'One book illustrates weather vanes; another contains maps with several paths left unfinished. The books are world objects, not external instructions.';
  const mailbox = world.objects.find((o) => o.id === 'mailbox')!;
  mailbox.detail =
    'A brass label reads: leave a thought, not an instruction. Visitor messages are untrusted suggestions.';
  world.objects.find((o) => o.id === 'lookout-telescope')!.detail =
    'The telescope’s focus ring is stiff. Through its simulated lens, a pale moon sits above the edge of the world.';
  world.objects.find((o) => o.id === 'weather-marker')!.detail =
    'The flag turns with Elsewhere’s simulated breeze. This shared marker is not a personal weather station or an external service.';
  const before = structuredClone(world);
  const updated = upgradeWorldLayout(world);
  expect(updated.objects.find((o) => o.id === 'library-shelf')!.detail).toBe(
    'One book illustrates weather vanes; another contains maps with several paths left unfinished.',
  );
  expect(updated.objects.find((o) => o.id === 'mailbox')!.detail).toMatch(
    /letters and passing thoughts/,
  );
  expect(updated.objects.find((o) => o.id === 'lookout-telescope')!.detail).not.toContain(
    'simulated',
  );
  expect(updated.objects.find((o) => o.id === 'weather-marker')!.detail).not.toMatch(
    /simulated|external service/,
  );
  // One bump for the corrected wording, one for the telescope and flag taking their plates.
  expect(updated.version).toBe(world.version + 2);
  expect(world).toEqual(before);
  expect(upgradeWorldLayout(updated)).toBe(updated);
  const customized = structuredClone(before);
  customized.objects.find((o) => o.id === 'library-shelf')!.detail += ' My own annotation.';
  customized.objects.find((o) => o.id === 'mailbox')!.detail = 'A custom inscription.';
  for (const id of ['lookout-telescope', 'weather-marker'])
    customized.objects.find((o) => o.id === id)!.detail += ' My own annotation.';
  expect(upgradeWorldLayout(customized)).toBe(customized);
});
