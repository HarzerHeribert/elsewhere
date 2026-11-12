import { describe, expect, it } from 'vitest';
import type { WorldState } from '@elsewhere/character-interfaces';
import {
  createInitialWorld,
  executeWorldCommand,
  findPath,
  isWalkable,
  observeWorld,
  publicWorld,
  upgradeWorldLayout,
} from '../src/world';

const NEW_IDS = ['easel', 'pinned-music-box', 'specimen-tray', 'seed-drawers', 'launch-stand'];
const WORKED = [
  'windchime',
  'standing-stones',
  'sundial',
  'lookout-telescope',
  'pond-water',
  'weather-marker',
  'garden',
  'orchard-tree',
  'window',
  ...NEW_IDS,
];
const noon = Date.UTC(2026, 10, 9, 12);

describe('the working objects in the world', () => {
  it('are reachable from the resident start and clear of obstacles and each other', () => {
    const world = createInitialWorld(noon);
    const start = world.residents[0].position;
    for (const id of NEW_IDS) {
      const object = world.objects.find((item) => item.id === id)!;
      expect(object, id).toBeTruthy();
      for (const o of world.obstacles) {
        const dx = Math.max(o.minX - object.position.x, 0, object.position.x - o.maxX);
        const dz = Math.max(o.minZ - object.position.z, 0, object.position.z - o.maxZ);
        expect(Math.hypot(dx, dz), `${id} against ${o.id}`).toBeGreaterThan(object.radius);
      }
      for (const other of world.objects) {
        if (other.id === id || other.elevation || object.elevation) continue;
        expect(
          Math.hypot(other.position.x - object.position.x, other.position.z - object.position.z),
          `${id} against ${other.id}`,
        ).toBeGreaterThan(other.radius + object.radius);
      }
      const moved = executeWorldCommand(world, 'hubert', { type: 'move', targetId: id }, noon);
      expect(moved.outcome.status, id).toMatch(/started|completed/);
      const destination = moved.world.residents[0].destination!;
      expect(isWalkable(world, destination), id).toBe(true);
      expect(findPath(world, start, destination), id).not.toBeNull();
    }
    expect(world.objects.map((item) => item.id).filter((id) => id === 'music-box')).toEqual([]);
  });

  it('say what can be done there without stating a rule, in objects and in places', () => {
    const world = createInitialWorld(noon);
    for (const id of WORKED)
      expect(world.objects.find((item) => item.id === id)!.description, id).toMatch(/\.$/);
    const text = (id: string) => world.places.find((place) => place.id === id)!.description;
    expect(text('workshop')).toMatch(/prism.*seed/);
    expect(text('courtyard')).toMatch(/easel/);
    expect(text('library')).toMatch(/writing.*specimens.*music box/);
    expect(text('meadow')).toMatch(/launching/);
    expect(world.objects.find((item) => item.id === 'reading-table')!.affordances).toContain(
      'work',
    );
    expect(world.objects.find((item) => item.id === 'easel')!.affordances).toContain('work');
  });

  it('keep hidden state out of the public world and out of observations', () => {
    let world = createInitialWorld(noon);
    const use = (id: string, control: string, value?: number) => {
      const object = world.objects.find((item) => item.id === id)!;
      world.residents[0].position = { x: object.position.x, z: object.position.z + 0.5 };
      world.obstacles = [];
      const result = executeWorldCommand(
        world,
        'hubert',
        { type: 'use', targetId: id, control, value },
        noon,
      );
      expect(result.outcome.status, `${id} ${control}: ${result.outcome.summary}`).toBe(
        'completed',
      );
      world = result.world;
    };
    use('windchime', 'shift', 12);
    use('sundial', 'mark');
    use('weather-marker', 'log');
    use('garden', 'water', 3);
    use('orchard-tree', 'shake', 4);
    use('window', 'turn', 50);
    use('easel', 'red', 4);
    use('pinned-music-box', 'note', 3);
    use('launch-stand', 'pump', 9);
    use('specimen-tray', 'power', 12);
    use('seed-drawers', 'sow');
    use('lookout-telescope', 'focus', 55);
    use('standing-stones', 'pick', 4);
    expect(Object.keys(world.mechanisms ?? {}).length).toBeGreaterThanOrEqual(13);
    const shown = JSON.stringify(publicWorld(world));
    const seen = JSON.stringify(observeWorld(world, 'hubert'));
    for (const text of [shown, seen]) {
      expect(text).not.toContain('"mechanisms"');
      expect(text).not.toMatch(
        /"(uses|marks|tally|shift\d|notes|strokes|sownAt|sowing|gone|ground|cups|since|focus|turn|slit|pick|tempo|power|mother|father|fin|bob|length|heightCm)":/,
      );
      expect(text).not.toMatch(/sunElevation|windSpeed|airTemp|windBearing/);
    }
    for (const id of WORKED) {
      const controls = publicWorld(world).objects.find((item) => item.id === id)!.controls;
      expect(controls?.length, id).toBeGreaterThanOrEqual(2);
    }
    // Only the fixed, public facts of the objects appear in an observation.
    world.residents[0].position = { x: 8.4, z: -3.8 };
    world.residents[0].facing = Math.PI;
    expect(JSON.stringify(observeWorld(world, 'hubert'))).toContain('"id":"dab"');
  });

  it('gives the easel the real world to frame', () => {
    const world = createInitialWorld(noon);
    const easel = world.objects.find((item) => item.id === 'easel')!;
    world.residents[0].position = { x: easel.position.x, z: easel.position.z + 1 };
    const result = executeWorldCommand(
      world,
      'hubert',
      { type: 'use', targetId: 'easel', control: 'frame', value: 232 },
      noon,
    );
    expect(result.outcome.summary).toMatch(/little garden/);
  });
});

describe('upgrading a saved world', () => {
  const previous = (): WorldState => {
    const world = createInitialWorld(noon);
    world.objects = world.objects.filter((item) => !NEW_IDS.includes(item.id));
    const set = (id: string, description: string) => {
      world.objects.find((item) => item.id === id)!.description = description;
    };
    set('reading-table', 'A broad table beside an open notebook.');
    world.objects.find((item) => item.id === 'reading-table')!.affordances = [
      'inspect',
      'interact',
    ];
    set('window', 'A bright window with a deep sill.');
    set('garden', 'A raised bed of small plants.');
    set('orchard-tree', 'A branching tree in the orchard, with uneven fruit and a shaded trunk.');
    set('pond-water', 'A shallow pond reflecting the trees and sky.');
    set('windchime', 'Small copper tubes hung from a wooden frame.');
    set('standing-stones', 'Three weathered stones beside the orchard path.');
    set('sundial', 'A low stone circle with a copper pointer.');
    set('lookout-telescope', 'A public brass telescope on a three-legged stand.');
    set('weather-marker', 'A simple wind flag beside the path to the lookout.');
    world.places.find((place) => place.id === 'workshop')!.description =
      'A sheltered place for experiments and unfinished ideas.';
    return world;
  };

  it('adds the new objects and the changed text and affordances, once', () => {
    const old = previous();
    const upgraded = upgradeWorldLayout(old);
    const fresh = createInitialWorld(noon);
    for (const id of NEW_IDS)
      expect(upgraded.objects.find((item) => item.id === id)).toEqual(
        fresh.objects.find((item) => item.id === id),
      );
    for (const id of WORKED.filter((item) => !NEW_IDS.includes(item)))
      expect(upgraded.objects.find((item) => item.id === id)!.description, id).toBe(
        fresh.objects.find((item) => item.id === id)!.description,
      );
    expect(upgraded.objects.find((item) => item.id === 'reading-table')!.affordances).toContain(
      'work',
    );
    expect(upgraded.places.find((place) => place.id === 'workshop')!.description).toMatch(/prism/);
    expect(upgraded.version).toBeGreaterThan(old.version);
    expect(upgradeWorldLayout(upgraded)).toBe(upgraded);
    expect(old.objects.some((item) => item.id === 'easel')).toBe(false);
  });

  it('turns the old vane into the pendulum stand, drops the vane’s state and keeps the plate current', () => {
    const old = previous();
    const artifact = old.objects.find((item) => item.id === 'artifact')!;
    artifact.name = 'An unfamiliar object';
    artifact.description = 'Something small rests beside the workbench.';
    artifact.detail =
      'It is a tiny hand-cranked weather vane with a crooked copper fin. Turning the crank makes the fin wobble instead of spin.';
    old.objects.find((item) => item.id === 'garden')!.detail =
      'Three seedlings lean toward the same patch of light. One leaf has an unexpectedly geometric edge.';
    old.places.find((place) => place.id === 'workshop')!.description =
      'A sheltered place for experiments and unfinished ideas, with a workbench, a window with a glass prism on its sill, drawers of seed and an unfamiliar mechanism.';
    old.mechanisms = {
      artifact: { fin: 3, uses: 4 },
      garden: { height: [12, 15, 9], since: 5, uses: 1 },
    };
    const upgraded = upgradeWorldLayout(old);
    const fresh = createInitialWorld(noon);
    const after = (id: string) => upgraded.objects.find((item) => item.id === id)!;
    expect(after('artifact').name).toBe('The pendulum stand');
    expect(after('artifact').description).toBe(
      fresh.objects.find((item) => item.id === 'artifact')!.description,
    );
    expect(after('artifact').detail).toMatch(/pendulum rig/);
    expect(after('garden').detail).toMatch(/Phaseolus coccineus/);
    expect(after('weather-marker').description).toMatch(/numbered bands/);
    expect(upgraded.places.find((place) => place.id === 'workshop')!.description).toMatch(
      /pendulum/,
    );
    expect(upgraded.mechanisms).toEqual({ artifact: { uses: 4 }, garden: { since: 5, uses: 1 } });
    expect(JSON.stringify(upgraded.objects.map((item) => item.detail))).not.toMatch(
      /vane with a crooked/,
    );
    expect(upgradeWorldLayout(upgraded)).toBe(upgraded);
  });

  it('keeps text an operator changed and a resident’s stored readings', () => {
    const old = previous();
    old.objects.find((item) => item.id === 'sundial')!.description = 'My own dial.';
    old.mechanisms = { sundial: { uses: 3, marks: [4.5, 90, 1000] } };
    const upgraded = upgradeWorldLayout(old);
    expect(upgraded.objects.find((item) => item.id === 'sundial')!.description).toBe(
      'My own dial.',
    );
    expect(upgraded.mechanisms).toEqual(old.mechanisms);
  });
});
