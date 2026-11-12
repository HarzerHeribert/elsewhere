import { describe, expect, it } from 'vitest';
import { createInitialWorld } from './world.js';
import { mechanismFor, operate, worldConditions, type MechanismState } from './mechanisms/index.js';
import { skyAt } from './mechanisms/telescope.js';

const world = createInitialWorld(0);
const object = (id: string) => world.objects.find((item) => item.id === id)!;
const scene = { objects: world.objects, places: world.places };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const day = Date.UTC(2026, 10, 9, 0, 0);
const noon = day + 12 * HOUR;

/** Works one control, returning the reading and the state to carry on with. */
function use(
  id: string,
  state: MechanismState | undefined,
  control: string,
  value?: number,
  at = noon,
) {
  const result = operate(object(id), control, value, state, at, scene);
  if (!result.ok) throw new Error(result.problem);
  return result;
}
/** Works a sequence on one object, returning the last reading and the final state. */
function session(id: string, steps: Array<[string, number?]>, at = noon, state?: MechanismState) {
  let current = state;
  let reading = '';
  for (const [control, value] of steps) {
    const result = use(id, current, control, value, at);
    current = result.state;
    reading = result.reading;
  }
  return { reading, state: current! };
}
const first = (text: string, pattern: RegExp) => Number(text.match(pattern)?.[1]);

describe('every working object offers several things to do', () => {
  it('lists at least two controls for each, apart from the singletons', () => {
    for (const id of [
      'windchime',
      'standing-stones',
      'sundial',
      'lookout-telescope',
      'pond-water',
      'weather-marker',
      'garden',
      'orchard-tree',
      'window',
      'easel',
      'pinned-music-box',
      'launch-stand',
      'specimen-tray',
      'seed-drawers',
    ])
      expect(mechanismFor(object(id).kind)?.length, id).toBeGreaterThanOrEqual(2);
  });

  it('keeps every reading and refusal free of the rule behind it', () => {
    const text = JSON.stringify(
      world.objects.map((item) => mechanismFor(item.kind)).filter(Boolean),
    );
    expect(text).not.toMatch(/wind speed|temperature|threshold|sun\b|squared|ratio|dominant/i);
  });

  it('refuses a bad value with its range and an unknown control with the valid ids', () => {
    const range = operate(object('launch-stand'), 'pump', 99, undefined, noon);
    expect(!range.ok && range.problem).toMatch(/1 to 30/);
    const unknown = operate(object('garden'), 'prune', undefined, undefined, noon);
    expect(!unknown.ok && unknown.problem).toMatch(/water, shade, measure/);
  });

  it('is deterministic for every object', () => {
    for (const item of world.objects) {
      const controls = mechanismFor(item.kind);
      if (!controls) continue;
      for (const control of controls) {
        const value = control.value ? control.value.min : undefined;
        expect(operate(item, control.id, value, undefined, noon, scene)).toEqual(
          operate(item, control.id, value, undefined, noon, scene),
        );
      }
    }
  });
});

describe('acoustics: the wind chime', () => {
  it('sounds higher when the collar shortens a tube, and measures what it moved', () => {
    const before = session('windchime', [['pick', 3]]);
    const length = first(use('windchime', before.state, 'measure').reading, /along ([\d.]+) cm/);
    const pitch = first(use('windchime', before.state, 'strike', 3).reading, /at (\d+) Hz/);
    const moved = session('windchime', [['shift', 20]], noon, before.state);
    const shorter = first(use('windchime', moved.state, 'measure').reading, /along ([\d.]+) cm/);
    expect(length - shorter).toBeGreaterThan(1.5);
    expect(length - shorter).toBeLessThan(2.5);
    expect(
      first(use('windchime', moved.state, 'strike', 3).reading, /at (\d+) Hz/),
    ).toBeGreaterThan(pitch);
    // The collar of another tube is untouched.
    const other = (state: MechanismState) =>
      first(use('windchime', state, 'strike', 2).reading, /at (\d+) Hz/);
    expect(Math.abs(other(moved.state) - other(before.state))).toBeLessThan(
      other(before.state) * 0.05,
    );
  });

  it('rings longer in a long tube and shorter in the wind', () => {
    const ring = (tube: number, at: number) =>
      first(use('windchime', undefined, 'strike', tube, at).reading, /for ([\d.]+) s/);
    expect(ring(1, noon)).toBeGreaterThan(ring(5, noon));
    let calm = day;
    let gusty = day;
    for (let m = 0; m < 24 * 60; m += 7) {
      const at = day + m * 60_000;
      if (worldConditions(at).windSpeed < worldConditions(calm).windSpeed) calm = at;
      if (worldConditions(at).windSpeed > worldConditions(gusty).windSpeed) gusty = at;
    }
    expect(ring(2, calm)).toBeGreaterThan(ring(2, gusty));
  });
});

describe('surveying: the standing stones', () => {
  it('measures, paces and sights between stones, refusing the picked stone itself', () => {
    const { state } = session('standing-stones', [['pick', 3]]);
    expect(use('standing-stones', state, 'measure').reading).toMatch(/Stone 3 stands 21\d cm/);
    expect(use('standing-stones', state, 'pace', 2).reading).toMatch(
      /From stone 3 to stone 2 is [\d.]+ paces/,
    );
    expect(operate(object('standing-stones'), 'pace', 3, state, noon)).toMatchObject({ ok: false });
    const paces = (n: number) =>
      first(use('standing-stones', state, 'pace', n).reading, /is ([\d.]+) paces/);
    expect(Number.isInteger(paces(1) * 2)).toBe(true);
  });

  it('knocks lower from taller stones', () => {
    const pitch = (n: number) =>
      first(use('standing-stones', undefined, 'tap', n).reading, /at (\d+) Hz/);
    expect(pitch(3)).toBeLessThan(pitch(6));
  });

  it('puts the real sun on the line of a solstice pair at its sunrise and far from it later', () => {
    const offAt = (from: number, over: number, at: number) => {
      const { state } = session('standing-stones', [['pick', from]]);
      const text = use('standing-stones', state, 'sight', over, at).reading;
      if (/sun is down/.test(text)) return Infinity;
      if (/on the line/.test(text)) return 0;
      return first(text, /stands (\d+) degrees to the/);
    };
    const risen = (start: number) => {
      for (let m = 0; m < 1440; m++)
        if (worldConditions(start + m * 60_000).sunElevationDeg > 0.7) return start + m * 60_000;
      return start;
    };
    const winter = risen(Date.UTC(2026, 11, 21));
    const summer = risen(Date.UTC(2026, 5, 21));
    expect(offAt(1, 4, winter)).toBeLessThanOrEqual(4);
    expect(offAt(2, 6, summer)).toBeLessThanOrEqual(4);
    expect(offAt(1, 4, winter + 3 * HOUR)).toBeGreaterThan(20);
    expect(offAt(1, 4, day + HOUR)).toBe(Infinity);
    // Another pair never lines up at that hour.
    expect(offAt(2, 5, winter)).toBeGreaterThan(5);
  });
});

describe('timekeeping: the sundial', () => {
  it('keeps marks that persist, lists them oldest first and caps them at 24', () => {
    let state: MechanismState | undefined;
    for (let i = 0; i < 30; i++)
      state = use('sundial', state, 'mark', undefined, day + 8 * HOUR + i * 10 * 60_000).state;
    const marks = state!.marks as number[];
    expect(marks).toHaveLength(72);
    const times = marks.filter((_, i) => i % 3 === 2);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(day + 8 * HOUR + 6 * 10 * 60_000);
    const listed = use('sundial', state, 'marks', undefined, day + 14 * HOUR).reading;
    expect(listed.match(/mark \d+:/g)).toHaveLength(24);
    expect(listed.indexOf('mark 1:')).toBeLessThan(listed.indexOf('mark 2:'));
    expect(listed).toMatch(/cm toward \d+ degrees, made/);
    expect(use('sundial', state, 'clear').reading).toMatch(/rubbed off/);
    expect(use('sundial', use('sundial', state, 'clear').state, 'marks').reading).toMatch(
      /no marks/,
    );
  });

  it('refuses a mark when there is no shadow', () => {
    const result = operate(object('sundial'), 'mark', undefined, undefined, day);
    expect(!result.ok && result.problem).toMatch(/no shadow/);
  });
});

describe('astronomy: the lookout telescope', () => {
  const night = day + HOUR;
  it('shows only the sun and perhaps the moon by day', () => {
    for (let h = 8; h < 17; h++)
      for (const body of skyAt(day + h * HOUR)) expect(body.seen).toMatch(/sun|moon/);
  });

  it('shows the fixed stars and the wanderer on a clear night, each with a height', () => {
    // The wanderer is the one light without a chart label; pick an hour of the night when it is up.
    const hours = Array.from({ length: 14 }, (_, h) => night + (18 + h) * HOUR);
    const at = hours.find((time) =>
      skyAt(time).some((body) => !/sun|moon/.test(body.seen) && !body.label),
    )!;
    expect(at).toBeDefined();
    const lights = skyAt(at).filter((body) => !/sun|moon/.test(body.seen));
    expect(lights.length).toBeGreaterThan(5);
    expect(lights.filter((body) => body.label).length).toBe(lights.length - 1);
    for (const body of lights) expect(body.elevation).toBeGreaterThan(0);
  });

  it('needs good focus to tell a faint star apart', () => {
    const at = night + 20 * HOUR;
    const { airTempC } = worldConditions(at);
    const best = Math.round(58 + 0.9 * (airTempC - 12));
    const faint = skyAt(at).find((body) => body.label === 'α UMi')!;
    const aim = Math.round(faint.bearing) % 360;
    const sharp = session(
      'lookout-telescope',
      [
        ['focus', best],
        ['aim', aim],
      ],
      at,
    ).reading;
    expect(sharp).toMatch(/steady yellow-white light, \d+ degrees up, marked α UMi on the chart/);
    const blurred = session(
      'lookout-telescope',
      [
        ['focus', 0],
        ['aim', aim],
      ],
      at,
    ).reading;
    expect(blurred).not.toMatch(/α UMi/);
    const bright = skyAt(at).find((body) => body.brightness >= 0.5 && body.label)!;
    expect(
      session(
        'lookout-telescope',
        [
          ['focus', Math.max(0, best - 8)],
          ['aim', Math.round(bright.bearing) % 360],
        ],
        at,
      ).reading,
    ).toMatch(/steady .* light/);
  });
});

describe('waves and fluids: the pond', () => {
  it('skips most near one angle', () => {
    const skips = (angle: number) =>
      first(use('pond-water', undefined, 'skip', angle).reading, /skipped (\d+)/);
    const sweep = Array.from({ length: 56 }, (_, i) => 5 + i);
    const peak = sweep.reduce((a, b) => (skips(b) > skips(a) ? b : a));
    expect(peak).toBeGreaterThanOrEqual(16);
    expect(peak).toBeLessThanOrEqual(24);
    expect(skips(60)).toBeLessThan(skips(peak));
    expect(skips(5)).toBeLessThan(skips(peak));
  });

  it('sails across in a time and lands somewhere along the bank that depend on the sail', () => {
    const sail = (value: number) => use('pond-water', undefined, 'sail', value).reading;
    expect(sail(40)).toMatch(/sail at 40 degrees .* crossed in [\d.]+ s and landed/);
    expect(first(sail(45), /in ([\d.]+) s/)).not.toBe(first(sail(0), /in ([\d.]+) s/));
  });
});

describe('meteorology: the weather marker tally', () => {
  it('keeps the newest 24 lines and reads them back oldest first with their age', () => {
    expect(use('weather-marker', undefined, 'tally').reading).toMatch(/blank/);
    let state: MechanismState | undefined;
    for (let i = 0; i < 30; i++)
      state = use('weather-marker', state, 'log', undefined, noon + i * 60_000).state;
    expect((state!.tally as number[]).length).toBe(72);
    const read = use('weather-marker', state, 'tally', undefined, noon + 40 * 60_000).reading;
    expect(read.match(/line \d+:/g)).toHaveLength(24);
    expect(read).toMatch(/written \d+ min ago/);
    expect((state!.tally as number[])[0]).toBe(noon + 6 * 60_000);
  });
});

describe('botany: the garden', () => {
  const heights = (reading: string) =>
    [...reading.matchAll(/stands ([\d.]+) cm/g)].map((m) => Number(m[1]));
  const lean = (reading: string) => first(reading, /leans ([\d.]+) degrees/);
  const grown = (cups: number, shade: number, hours: number) => {
    const { state } = session(
      'garden',
      [
        ['water', cups],
        ['shade', shade],
      ],
      noon,
    );
    return use('garden', state, 'measure', undefined, noon + hours * HOUR).reading;
  };

  it('grows most near two cups, and less under shade', () => {
    const total = (reading: string) => heights(reading).reduce((a, b) => a + b, 0);
    const two = total(grown(2, 0, 240));
    expect(two).toBeGreaterThan(total(grown(0, 0, 240)));
    expect(two).toBeGreaterThan(total(grown(5, 0, 240)));
    expect(total(grown(2, 80, 240))).toBeLessThan(two);
    expect(heights(grown(2, 0, 240))[2]).not.toBe(heights(grown(2, 0, 240))[0]);
    expect(grown(2, 0, 240)).toMatch(/^At 2 cups and 0% shade:/);
  });

  it('does not rewrite the past when a setting changes', () => {
    const { state } = session('garden', [['water', 2]], noon);
    const later = noon + 150 * HOUR;
    const before = heights(use('garden', state, 'measure', undefined, later).reading);
    const changed = use('garden', state, 'water', 5, later).state;
    const after = heights(use('garden', changed, 'measure', undefined, later).reading);
    after.forEach((h, i) => expect(Math.abs(h - before[i])).toBeLessThan(before[i] * 0.02));
    const further = heights(
      use('garden', changed, 'measure', undefined, later + 150 * HOUR).reading,
    );
    const stayed = heights(use('garden', state, 'measure', undefined, later + 150 * HOUR).reading);
    expect(stayed[0]).toBeGreaterThan(further[0]);
  });

  it('leans more under more shade and never grows past 300 cm', () => {
    expect(lean(grown(2, 80, 1))).toBeGreaterThan(lean(grown(2, 0, 1)));
    for (const h of heights(grown(2, 0, 100_000))) expect(h).toBeLessThanOrEqual(300);
  });
});

describe('natural history: the orchard tree', () => {
  const fell = (reading: string) => first(reading, /brought down (\d+)/);
  it('drops more when shaken harder, and keeps fallen fruit on the ground', () => {
    const gentle = fell(use('orchard-tree', undefined, 'shake', 1).reading);
    const hard = fell(use('orchard-tree', undefined, 'shake', 5).reading);
    expect(hard).toBeGreaterThan(gentle);
    const shaken = use('orchard-tree', undefined, 'shake', 5);
    expect(use('orchard-tree', shaken.state, 'count').reading).toContain(
      `${hard} apples lie on the ground`,
    );
    expect(use('orchard-tree', undefined, 'count').reading).toMatch(
      /\d+ small, \d+ middling and \d+ large apples; 0 apples lie/,
    );
  });

  it('yields more after days of ripening than straight after a shake', () => {
    const first5 = use('orchard-tree', undefined, 'shake', 5);
    const again = fell(use('orchard-tree', first5.state, 'shake', 5).reading);
    const later = fell(use('orchard-tree', first5.state, 'shake', 5, noon + 6 * DAY).reading);
    expect(later).toBeGreaterThan(again);
  });
});

describe('optics: the workshop window', () => {
  const edges = (reading: string) => [
    first(reading, /red edge falls (-?\d+)/),
    first(reading, /green (-?\d+) mm/),
    first(reading, /violet (-?\d+) mm/),
  ];
  it('spreads red, green and violet in order, and has no band at night or when the light cannot leave the glass', () => {
    const lit = session('window', [['turn', 50], ['slit', 3], ['read']]);
    const [red, green, violet] = edges(lit.reading);
    expect(red).toBeLessThan(green);
    expect(green).toBeLessThan(violet);
    expect(lit.reading).toMatch(/^With the light meeting the prism at 50 degrees and a 3 mm slit/);
    expect(session('window', [['turn', 50], ['read']], day + HOUR).reading).toMatch(
      /no band forms/,
    );
    expect(session('window', [['turn', 20], ['read']]).reading).toMatch(/no band forms/);
  });

  it('trades brightness for sharpness with the slit, and moves the band with the turn', () => {
    const read = (slit: number) =>
      session('window', [['turn', 50], ['slit', slit], ['read']]).reading;
    expect(first(read(1), /(\d+)% sharp/)).toBeGreaterThan(first(read(9), /(\d+)% sharp/));
    expect(first(read(1), /(\d+)% bright/)).toBeLessThan(first(read(9), /(\d+)% bright/));
    const at = (turn: number) => edges(session('window', [['turn', turn], ['read']]).reading)[0];
    expect(at(36)).not.toBe(at(50));
    // The least deviation sits at one setting: either side of it the band lies farther out.
    expect(at(50)).toBeLessThan(at(36));
    expect(at(50)).toBeLessThan(at(70));
  });
});

describe('illustration: the easel', () => {
  const light = (steps: Array<[string, number?]>) =>
    first(session('easel', [...steps, ['dab']]).reading, /, (\d+)% light/);
  it('mixes subtractively: more paint in total is darker, all three give a brown-grey', () => {
    expect(light([['red', 1]])).toBeGreaterThan(light([['red', 5]]));
    expect(light([['red', 5]])).toBeGreaterThan(light([['red', 10]]));
    const mud = session('easel', [['red', 3], ['yellow', 3], ['blue', 3], ['dab']]).reading;
    const [r, g, b] = (mud.match(/#([0-9a-f]{6})/)![1].match(/../g) ?? []).map((h) =>
      parseInt(h, 16),
    );
    expect(r).toBeGreaterThan(g);
    expect(r - b).toBeLessThan(80);
    expect(session('easel', [['dab']]).reading).toMatch(/nothing on the brush/);
    expect(session('easel', [['red', 2], ['dab']]).reading).toMatch(
      /^With 2 alizarin crimson, 0 cadmium yellow and 0 ultramarine blue/,
    );
  });

  it('frames what really lies in that direction and not what lies behind', () => {
    const easel = object('easel');
    const dial = object('sundial');
    const toward =
      (Math.atan2(dial.position.x - easel.position.x, -(dial.position.z - easel.position.z)) *
        180) /
      Math.PI;
    const facing = Math.round((toward + 360) % 360);
    const framed = use('easel', undefined, 'frame', facing).reading;
    expect(framed).toMatch(/The courtyard sundial, [\d.]+ m away, [\d.]+ wide to 1 tall/);
    expect(use('easel', undefined, 'frame', (facing + 180) % 360).reading).not.toMatch(
      /courtyard sundial/,
    );
  });
});

describe('composition: the music box', () => {
  const tune = (extra: Array<[string, number?]> = []) =>
    session('pinned-music-box', [
      ['step', 1],
      ['note', 1],
      ['step', 2],
      ['note', 5],
      ['step', 3],
      ['note', 2],
      ['step', 4],
      ['note', 1],
      ...extra,
      ['play'],
    ]);
  it('plays back exactly the steps that are set, and flags a rough pair', () => {
    const { reading } = tune();
    expect(reading.match(/step \d+ [\d.]+ Hz/g)).toHaveLength(4);
    expect(reading).toMatch(
      /step 1 261\.6 Hz, step 2 392\.0 Hz, step 3 293\.7 Hz, step 4 261\.6 Hz/,
    );
    expect(reading).toMatch(/steps 1 and 2 ring cleanly/);
    expect(reading).toMatch(/steps 3 and 4 beat roughly/);
  });
  it('turns for 16 steps at the tempo and rests when a note is cleared', () => {
    expect(tune([['tempo', 60]]).reading).toMatch(/At 60 steps per minute .* 16\.0 s/);
    const cleared = tune([
      ['step', 4],
      ['note', 0],
    ]).reading;
    expect(cleared.match(/step \d+ [\d.]+ Hz/g)).toHaveLength(3);
    expect(cleared).not.toMatch(/steps 3 and 4/);
  });
});

describe('rocketry: the launch stand', () => {
  let calm = day;
  for (let m = 0; m < 3 * 24 * 60; m += 5) {
    const at = day + m * 60_000;
    if (worldConditions(at).windSpeed < worldConditions(calm).windSpeed) calm = at;
  }
  const launch = (fill: number, strokes: number, tilt: number, at = calm) =>
    session('launch-stand', [['fill', fill], ['pump', strokes], ['tilt', tilt], ['launch']], at);
  const away = (fill: number, strokes: number, tilt: number) =>
    first(launch(fill, strokes, tilt).reading, /landed ([\d.]+) m away/);

  it('finds the air calm enough to compare', () => {
    expect(worldConditions(calm).windSpeed).toBeLessThan(0.7);
  });
  it('goes farthest near a third full and at a tilt a little under 45 degrees in still air', () => {
    const fills = Array.from({ length: 21 }, (_, i) => i * 5 + 5).filter((f) => f < 100);
    const bestFill = fills.reduce((a, b) => (away(b, 20, 45) > away(a, 20, 45) ? b : a));
    expect(bestFill).toBeGreaterThanOrEqual(28);
    expect(bestFill).toBeLessThanOrEqual(45);
    const tilts = Array.from({ length: 61 }, (_, i) => 30 + i);
    const bestTilt = tilts.reduce((a, b) => (away(33, 20, b) > away(33, 20, a) ? b : a));
    expect(bestTilt).toBeGreaterThanOrEqual(36);
    expect(bestTilt).toBeLessThanOrEqual(48);
    expect(launch(33, 20, 45).reading).toMatch(
      /^With 33% water, 20 strokes \(5\.00 bar\) and a tilt of 45 degrees the rocket rose [\d.]+ m, flew [\d.]+ s and landed/,
    );
  });
  it('rises higher with more pressure', () => {
    const rose = (s: number) => first(launch(33, s, 70).reading, /rose ([\d.]+) m/);
    expect(rose(20)).toBeGreaterThan(rose(8));
  });
  it('lets the seal go past the limit, tips over when empty or unpumped, and is empty after launch', () => {
    expect(launch(33, 30, 45).reading).toMatch(/seal let go on the stand/);
    expect(session('launch-stand', [['fill', 0], ['pump', 10], ['launch']]).reading).toMatch(
      /tipped over/,
    );
    expect(session('launch-stand', [['fill', 33], ['launch']]).reading).toMatch(/tipped over/);
    const done = launch(33, 20, 45);
    expect(done.state.fill).toBe(0);
    expect(done.state.strokes).toBe(0);
    expect(use('launch-stand', done.state, 'launch').reading).toMatch(/tipped over/);
    expect(
      session('launch-stand', [
        ['pump', 10],
        ['pump', 12],
      ]).state.strokes,
    ).toBe(22);
  });
});

describe('microscopy: the specimen tray', () => {
  const look = (pick: number, power: number) =>
    session('specimen-tray', [['pick', pick], ['power', power], ['look']]).reading;
  it('resolves structures only above their own power', () => {
    expect(look(2, 2)).toMatch(/veins/);
    expect(look(2, 2)).not.toMatch(/stomata/);
    expect(look(2, 19)).not.toMatch(/stomata/);
    expect(look(2, 20)).toMatch(/stomata/);
    expect(look(1, 60)).toMatch(/barbules/);
    expect(look(2, 10)).toMatch(/^Specimen 2, a leaf, at 10 times, in a field [\d.]+ mm wide/);
  });
  it('narrows the field as power rises so counts must be scaled', () => {
    const count = (power: number) => first(look(2, power), /(\d+) veins/);
    const field = (power: number) => first(look(2, power), /field ([\d.]+) mm wide/);
    expect(field(20)).toBeLessThan(field(10));
    expect(count(2)).toBeGreaterThan(count(10));
    expect(field(2)).toBe(9);
    expect(field(60)).toBeCloseTo(0.3, 2);
  });
});

describe('breeding: the seed drawers', () => {
  const sow = (mother: number, father: number, state?: MechanismState) =>
    session('seed-drawers', [['mother', mother], ['father', father], ['sow']], noon, state);
  const count = (state: MechanismState, hours: number) =>
    use('seed-drawers', state, 'count', undefined, noon + hours * HOUR).reading;
  it('reports only sprouting before three hours, and the pea traits after', () => {
    const { state } = sow(1, 2);
    const early = count(state, 1.5);
    expect(early).toMatch(/\d+ of 24 seeds have sprouted so far/);
    expect(early).not.toMatch(/tall|dwarf|round|wrinkled/);
    expect(first(count(state, 0.2), /: (\d+) of/)).toBeLessThanOrEqual(first(early, /: (\d+) of/));
    expect(use('seed-drawers', undefined, 'count').reading).toMatch(/empty/);
  });
  it('gives one form from two pure lines and about 3:1 from their offspring', () => {
    const pure = count(sow(1, 2).state, 4);
    expect(pure).toMatch(/24 tall and 0 dwarf, 24 with round seed and 0 with wrinkled seed/);
    let tall = 0;
    let plain = 0;
    let all = 0;
    let state: MechanismState | undefined;
    for (let i = 0; i < 60; i++) {
      state = sow(5, 5, state).state;
      const reading = count(state, 4);
      tall += first(reading, /(\d+) tall/);
      plain += first(reading, /(\d+) with round/);
      all += 24;
    }
    expect(tall / all).toBeGreaterThan(0.72);
    expect(tall / all).toBeLessThan(0.78);
    expect(plain / all).toBeGreaterThan(0.72);
    expect(plain / all).toBeLessThan(0.78);
  });
  it('replaces an earlier sowing', () => {
    const { state } = sow(1, 1);
    expect(count(sow(2, 2, state).state, 4)).toMatch(/line 2 crossed with line 2/);
  });
});
