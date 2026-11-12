import { describe, expect, it } from 'vitest';
import { createInitialWorld } from './world.js';
import { operate, worldConditions, type MechanismState } from './mechanisms/index.js';
import {
  LATITUDE,
  SOLSTICE_DECLINATION,
  STARS,
  WANDERER_MOONS,
  horizontalOf,
  moonPosition,
  phaseWords,
  risingBearing,
  starHorizontal,
  sunHorizontal,
  sunPosition,
  wandererMoonOffsets,
  wandererPosition,
} from './mechanisms/sky.js';
import { pendulumPeriod } from './mechanisms/artifact.js';
import { tubeFundamental } from './mechanisms/windchime.js';
import { WAVELENGTH_CM, rippleSpeed } from './mechanisms/pond.js';
import { bandFor } from './mechanisms/weather-marker.js';
import { glassIndex, prismDeviation } from './mechanisms/window.js';
import { BURST_BAR, flyRocket } from './mechanisms/launch-stand.js';
import { skyAt } from './mechanisms/telescope.js';

const world = createInitialWorld(0);
const object = (id: string) => world.objects.find((item) => item.id === id)!;
const scene = { objects: world.objects, places: world.places };
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const day = Date.UTC(2026, 10, 9, 0, 0);
const noon = day + 12 * HOUR;
const first = (text: string, pattern: RegExp) => Number(text.match(pattern)?.[1]);

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
/** The highest and lowest sun of a UTC day, found by scanning it by the minute. */
const peak = (start: number) => {
  let best = { at: start, elevationDeg: -90, bearingDeg: 0 };
  for (let m = 0; m < 1440; m++) {
    const sun = sunHorizontal(start + m * MINUTE);
    if (sun.elevationDeg > best.elevationDeg) best = { at: start + m * MINUTE, ...sun };
  }
  return best;
};

describe('the real sun over 51 N, 10 E', () => {
  it('stands 62.4 degrees high at noon at midsummer and 15.6 at midwinter, due south', () => {
    const summer = peak(Date.UTC(2026, 5, 21));
    const winter = peak(Date.UTC(2026, 11, 21));
    expect(summer.elevationDeg).toBeCloseTo(62.4, 0);
    expect(winter.elevationDeg).toBeCloseTo(15.6, 0);
    expect(Math.abs(summer.bearingDeg - 180)).toBeLessThan(3);
    // Local noon at 10 E is about 11:20 UTC, moved a little by the equation of time.
    expect(summer.at - Date.UTC(2026, 5, 21)).toBeGreaterThan(11 * HOUR);
    expect(summer.at - Date.UTC(2026, 5, 21)).toBeLessThan(12 * HOUR);
  });
  it('rises due east at the equinox, in the south-east at midwinter and north-east at midsummer', () => {
    const rising = (start: number) => {
      for (let m = 0; m < 1440; m++) {
        const at = start + m * MINUTE;
        if (sunHorizontal(at).elevationDeg > 0) return sunHorizontal(at).bearingDeg;
      }
      return NaN;
    };
    expect(Math.abs(rising(Date.UTC(2026, 2, 20)) - 90)).toBeLessThan(1.5);
    expect(
      Math.abs(rising(Date.UTC(2026, 11, 21)) - risingBearing(-SOLSTICE_DECLINATION)),
    ).toBeLessThan(2);
    expect(
      Math.abs(rising(Date.UTC(2026, 5, 21)) - risingBearing(SOLSTICE_DECLINATION)),
    ).toBeLessThan(2);
    expect(risingBearing(-SOLSTICE_DECLINATION)).toBeGreaterThan(127);
    expect(risingBearing(-SOLSTICE_DECLINATION)).toBeLessThan(131);
  });
  it('feeds the conditions, with the equation of time and the declination in range', () => {
    const at = Date.UTC(2026, 10, 3, 11, 20);
    expect(worldConditions(at).sunElevationDeg).toBeCloseTo(sunHorizontal(at).elevationDeg, 9);
    expect(Math.abs(sunPosition(at).equationOfTimeMin - 16.4)).toBeLessThan(0.7);
    expect(sunPosition(Date.UTC(2026, 5, 21, 12)).decDeg).toBeCloseTo(23.44, 1);
  });
});

describe('mechanics: the pendulum', () => {
  const ten = (length: number, angle: number, bob = 3) =>
    first(
      session('artifact', [
        ['length', length],
        ['bob', bob],
        ['release', angle],
      ]).reading,
      /took ([\d.]+) s/,
    ) / 10;
  it('keeps the small-angle period for three lengths, within half a percent', () => {
    for (const length of [25, 100, 190]) {
      const ideal = 2 * Math.PI * Math.sqrt(length / 100 / 9.811);
      expect(Math.abs(ten(length, 3) - ideal) / ideal).toBeLessThan(0.005);
    }
  });
  it('swings slower from a wide release and does not care which bob hangs', () => {
    expect(ten(100, 60)).toBeGreaterThan(ten(100, 5) * 1.06);
    expect(pendulumPeriod(100, 60) / pendulumPeriod(100, 1)).toBeCloseTo(1.0732, 2);
    for (const bob of [1, 2, 4, 5])
      expect(Math.abs(ten(100, 20, bob) - ten(100, 20, 3))).toBeLessThan(0.01);
  });
  it('lets a lighter bob damp sooner', () => {
    const swings = (bob: number) =>
      first(
        session('artifact', [
          ['bob', bob],
          ['release', 20],
        ]).reading,
        /after (\d+) swings/,
      );
    expect(swings(1)).toBeLessThan(swings(5));
  });
});

describe('acoustics: the copper tubes', () => {
  it('ring at 95.6 / L^2 Hz with an overtone at 2.756 times that', () => {
    for (const [tube, cm] of [
      [1, 48],
      [2, 42],
      [3, 37],
      [4, 33],
      [5, 30],
    ] as const) {
      const reading = use('windchime', undefined, 'strike', tube).reading;
      const pitch = first(reading, /rings at (\d+) Hz/);
      const overtone = first(reading, /overtone at (\d+) Hz/);
      expect(Math.abs(pitch - 95.6 / (cm / 100) ** 2) / pitch).toBeLessThan(0.01);
      expect(Math.abs(overtone / pitch - 2.756)).toBeLessThan(0.01);
    }
    expect(Math.abs(tubeFundamental(0.4) - 95.6 / 0.16) / 597).toBeLessThan(0.01);
  });
});

describe('surveying: the stones and the solstice sun', () => {
  const line = (from: number, over: number) => {
    const { state } = session('standing-stones', [['pick', from]]);
    return first(
      use('standing-stones', state, 'sight', over, day + HOUR).reading,
      /runs on (\d+) degrees/,
    );
  };
  it('lines 1 over 4 on the midwinter sunrise and 2 over 6 on the midsummer sunrise', () => {
    expect(Math.abs(line(1, 4) - risingBearing(-SOLSTICE_DECLINATION))).toBeLessThan(2);
    expect(Math.abs(line(2, 6) - risingBearing(SOLSTICE_DECLINATION))).toBeLessThan(2);
    expect(line(1, 4)).toBeGreaterThan(125);
    expect(line(1, 4)).toBeLessThan(133);
  });
  it('points no other pair at either sunrise, forward or back', () => {
    const specials = [risingBearing(-SOLSTICE_DECLINATION), risingBearing(SOLSTICE_DECLINATION)];
    for (let a = 1; a <= 7; a++)
      for (let b = 1; b <= 7; b++) {
        if (a === b || (a === 1 && b === 4) || (a === 4 && b === 1)) continue;
        if ((a === 2 && b === 6) || (a === 6 && b === 2)) continue;
        for (const special of specials) {
          const off = Math.abs(((((line(a, b) - special + 90) % 180) + 180) % 180) - 90);
          expect(off, `${a} over ${b}`).toBeGreaterThan(5);
        }
      }
  });
  it('has heights between 90 and 210 cm', () => {
    for (let n = 1; n <= 7; n++) {
      const { state } = session('standing-stones', [['pick', n]]);
      const cm = first(use('standing-stones', state, 'measure').reading, /stands (\d+) cm/);
      expect(cm).toBeGreaterThanOrEqual(88);
      expect(cm).toBeLessThanOrEqual(212);
    }
  });
});

describe('timekeeping: the 18 cm pin', () => {
  it('throws a tip 18 / tan(elevation) cm out, away from the sun, at three times of day', () => {
    for (const hour of [8.5, 10.5, 13]) {
      const at = Date.UTC(2026, 3, 15, hour);
      const sun = worldConditions(at);
      const reading = use('sundial', undefined, 'read', undefined, at).reading;
      const length = first(reading, /shadow is ([\d.]+) cm/);
      const expected = 18 / Math.tan((sun.sunElevationDeg * Math.PI) / 180);
      expect(Math.abs(length - expected) / expected).toBeLessThan(0.01);
      const falls = first(reading, /toward (\d+) degrees/);
      const away = (sun.sunBearingDeg + 180) % 360;
      expect(Math.abs(((falls - away + 540) % 360) - 180)).toBeLessThan(1.5);
    }
  });
});

describe('astronomy: the night sky', () => {
  it('puts a star at 90 - 51 + declination at upper culmination', () => {
    for (const name of ['Vega', 'Capella', 'Altair', 'Arcturus']) {
      const star = STARS.find((item) => item.name === name)!;
      let best = -90;
      for (let m = 0; m < 1440; m++)
        best = Math.max(best, starHorizontal(star, day + m * MINUTE).elevationDeg);
      expect(Math.abs(best - (90 - LATITUDE + star.decDeg)), name).toBeLessThan(0.5);
    }
  });
  it('keeps Polaris within 1.5 degrees of 51 degrees all night, and nearly north', () => {
    const polaris = STARS.find((item) => item.name === 'Polaris')!;
    for (let m = 0; m < 1440; m += 10) {
      const place = starHorizontal(polaris, day + m * MINUTE);
      expect(Math.abs(place.elevationDeg - 51)).toBeLessThan(1.5);
      expect(Math.min(place.bearingDeg, 360 - place.bearingDeg)).toBeLessThan(3);
    }
  });
  it('carries fourteen bright stars with their true colours and brightness', () => {
    expect(STARS).toHaveLength(14);
    expect(STARS.find((item) => item.name === 'Antares')!.colour).toBe('red');
    expect(STARS.find((item) => item.name === 'Sirius')!.magnitude).toBeLessThan(-1);
  });
  it('lets the wanderer drift 0.083 degrees a day beside the lion’s heart in mid-November', () => {
    const aldebaran = STARS.find((item) => item.name === 'Regulus')!;
    const at = Date.UTC(2026, 10, 15);
    const a = wandererPosition(at);
    const b = wandererPosition(at + 10 * DAY);
    expect(Math.abs(a.raDeg - aldebaran.raHours * 15)).toBeLessThan(10);
    expect(Math.abs(a.decDeg - aldebaran.decDeg)).toBeLessThan(10);
    expect(b.raDeg - a.raDeg).toBeGreaterThan(0.7);
    expect(b.raDeg - a.raDeg).toBeLessThan(1);
  });
  it('repeats the four points beside it with their real periods and keeps their reach', () => {
    const at = Date.UTC(2026, 10, 20, 21);
    WANDERER_MOONS.forEach((moon, i) => {
      const now = wandererMoonOffsets(at)[i].offset;
      for (const turns of [1, 3])
        expect(wandererMoonOffsets(at + turns * moon.periodDays * DAY)[i].offset).toBeCloseTo(
          now,
          6,
        );
      expect(wandererMoonOffsets(at + (moon.periodDays * DAY) / 2)[i].offset).toBeCloseTo(-now, 6);
    });
    expect(WANDERER_MOONS.map((moon) => moon.periodDays)).toEqual([1.769, 3.551, 7.155, 16.689]);
    expect(WANDERER_MOONS.map((moon) => moon.radius)).toEqual([5.9, 9.4, 15, 26.4]);
    for (let h = 0; h < 800; h += 5)
      wandererMoonOffsets(at + h * HOUR).forEach((point, i) =>
        expect(Math.abs(point.offset)).toBeLessThanOrEqual(WANDERER_MOONS[i].radius + 1e-9),
      );
  });
  it('runs the moon through its phases in one synodic month', () => {
    const lit = (at: number) => moonPosition(at).lit;
    const start = Date.UTC(2026, 10, 9);
    const fulls = [];
    for (let h = 0; h < 40 * 24; h++)
      if (lit(start + h * HOUR) > 0.995) fulls.push(start + h * HOUR);
    const gap = (fulls.at(-1)! - fulls[0]!) / DAY;
    expect(fulls.length).toBeGreaterThan(0);
    expect(phaseWords(20)).toMatch(/thin crescent.*right/);
    expect(phaseWords(90)).toMatch(/half lit/);
    expect(phaseWords(160)).toMatch(/nearly full/);
    expect(phaseWords(300)).toMatch(/crescent.*left|more than half.*left|half lit.*left/);
    expect(gap).toBeLessThan(40);
    // New moon on 9 November 2026 (about 22:02 UTC): the moon is a dark disc then.
    expect(moonPosition(Date.UTC(2026, 10, 9, 22)).lit).toBeLessThan(0.02);
    expect(moonPosition(Date.UTC(2026, 10, 24, 14)).lit).toBeGreaterThan(0.97);
  });
  it('shows at crisp focus the chart label and, beside the wanderer, up to four points', () => {
    // A clear night in November with the sun well down.
    const night = Date.UTC(2026, 10, 18, 20);
    const vega = STARS.find((item) => item.name === 'Vega')!;
    const place = starHorizontal(vega, night);
    expect(place.elevationDeg).toBeGreaterThan(5);
    const { airTempC } = worldConditions(night);
    const best = Math.round(58 + 0.9 * (airTempC - 12));
    const reading = session(
      'lookout-telescope',
      [
        ['focus', best],
        ['aim', Math.round(place.bearingDeg) % 360],
      ],
      night,
    ).reading;
    expect(reading).toMatch(/blue-white light, \d+ degrees up, marked α Lyr on the chart/);
    const blurred = session(
      'lookout-telescope',
      [
        ['focus', Math.max(0, best - 20)],
        ['aim', Math.round(place.bearingDeg) % 360],
      ],
      night,
    ).reading;
    expect(blurred).not.toMatch(/α Lyr/);
    // The wanderer stands in the Lion in November 2026 and only rises late in the night.
    const late = Date.UTC(2026, 10, 19, 3);
    const wanderer = skyAt(late).find((body) => body.points);
    expect(wanderer).toBeDefined();
    const seen = session(
      'lookout-telescope',
      [
        ['focus', Math.round(58 + 0.9 * (worldConditions(late).airTempC - 12))],
        ['aim', Math.round(wanderer!.bearing) % 360],
      ],
      late,
    ).reading;
    expect(seen).toMatch(/tiny points? in a line beside it/);
    expect(seen).not.toMatch(/Jupiter/i);
    const eye = horizontalOf(0, 0, night);
    expect(eye.bearingDeg).toBeGreaterThanOrEqual(0);
  });
});

describe('waves: the pond', () => {
  it('moves the first ring at the capillary-gravity speed, slowest for the middle pebble', () => {
    const speeds = [1, 2, 3, 4, 5].map((size) => {
      const reading = use('pond-water', undefined, 'drop', size).reading;
      const spacing = first(reading, /rings lie ([\d.]+) cm/);
      const speed = first(reading, /travels at ([\d.]+) cm\/s/);
      const seconds = first(reading, /after ([\d.]+) s/);
      expect(Math.abs(spacing - WAVELENGTH_CM[size - 1])).toBeLessThan(0.06);
      expect(Math.abs(speed - rippleSpeed(WAVELENGTH_CM[size - 1])) / speed).toBeLessThan(0.01);
      expect(Math.abs(seconds - 200 / speed) / seconds).toBeLessThan(0.02);
      return speed;
    });
    expect(speeds.indexOf(Math.min(...speeds))).toBe(2);
    expect(rippleSpeed(1.7)).toBeCloseTo(23.1, 0);
  });
  it('skips a stone most near 20 degrees and not at all by 45', () => {
    const skips = (angle: number) =>
      first(use('pond-water', undefined, 'skip', angle).reading, /skipped (\d+)/);
    expect(skips(45)).toBe(0);
    expect(skips(55)).toBe(0);
    expect(skips(20)).toBeGreaterThanOrEqual(6);
  });
});

describe('meteorology: the painted bands', () => {
  it('puts 4 m/s in band 3 and keeps the real limits', () => {
    expect(bandFor(4)).toBe(3);
    expect(bandFor(0.2)).toBe(0);
    expect(bandFor(2)).toBe(2);
    expect(bandFor(9)).toBe(5);
    expect(bandFor(40)).toBe(12);
  });
  it('says which band fits now, without naming the scale', () => {
    const reading = use('weather-marker', undefined, 'read').reading;
    expect(reading).toMatch(/painted band that fits is \d+: /);
    expect(reading).not.toMatch(/Beaufort/);
  });
});

describe('optics: the 60 degree crown-glass prism', () => {
  it('has a least deviation, red turning less than violet, and total internal reflection when too shallow', () => {
    const sweep = Array.from({ length: 51 }, (_, i) => 30 + i);
    const red = sweep.map((angle) => prismDeviation(angle, 656));
    const violet = sweep.map((angle) => prismDeviation(angle, 405));
    const defined = red.map((value, i) => ({ angle: sweep[i], value }));
    const least = defined.reduce((a, b) => ((b.value ?? 99) < (a.value ?? 99) ? b : a));
    expect(least.angle).toBeGreaterThan(46);
    expect(least.angle).toBeLessThan(52);
    expect(least.value).toBeCloseTo(38.4, 0);
    expect((prismDeviation(30, 656) ?? 0) > (least.value ?? 0)).toBe(true);
    expect((prismDeviation(80, 656) ?? 0) > (least.value ?? 0)).toBe(true);
    sweep.forEach((_, i) => {
      if (red[i] !== undefined && violet[i] !== undefined) expect(red[i]!).toBeLessThan(violet[i]!);
    });
    expect(prismDeviation(25, 405)).toBeUndefined();
    expect(glassIndex(656)).toBeCloseTo(1.5144, 3);
  });
  it('reads where the edges fall on the screen in mm, and nothing in the dark or past the glass’s turning back', () => {
    const lit = session('window', [['turn', 50], ['slit', 3], ['read']]).reading;
    const red = first(lit, /red edge falls (-?\d+) mm/);
    const violet = first(lit, /violet (-?\d+) mm/);
    expect(red).toBeGreaterThan(300);
    expect(violet).toBeGreaterThan(red);
    expect(session('window', [['turn', 20], ['read']]).reading).toMatch(/no band forms/);
    expect(operate(object('window'), 'turn', 85, undefined, noon).ok).toBe(false);
    expect(operate(object('window'), 'turn', 15, undefined, noon).ok).toBe(false);
  });
});

describe('composition: the C major comb', () => {
  const pair = (a: number, b: number) =>
    session('pinned-music-box', [['step', 1], ['note', a], ['step', 2], ['note', b], ['play']])
      .reading;
  it('rings C4-G4 cleanly and C4-D4 roughly, and names only frequencies', () => {
    expect(pair(1, 5)).toMatch(/steps 1 and 2 ring cleanly/);
    expect(pair(1, 2)).toMatch(/steps 1 and 2 beat roughly/);
    expect(pair(3, 4)).toMatch(/beat roughly/);
    expect(pair(1, 8)).toMatch(/ring cleanly/);
    expect(pair(1, 7)).toMatch(/beat roughly/);
    expect(pair(1, 1)).toMatch(/ring cleanly/);
    expect(pair(1, 5)).toMatch(/step 1 261\.6 Hz, step 2 392\.0 Hz/);
    expect(pair(1, 5)).not.toMatch(/\b[A-G][4-5]\b|sharp|flat/);
  });
});

describe('rocketry: a water rocket', () => {
  const fly = (fill: number, bar: number, tilt = 80) =>
    flyRocket({
      fillFraction: fill,
      gaugeBar: bar,
      tiltDeg: tilt,
      headingDeg: 300,
      windSpeed: 0,
      windBearingDeg: 0,
      airTempC: 12,
    });
  it('flies higher with more pressure', () => {
    expect(fly(0.33, 5).apogeeM).toBeGreaterThan(fly(0.33, 2.5).apogeeM);
    expect(fly(0.33, 2.5).apogeeM).toBeGreaterThan(fly(0.33, 1).apogeeM);
    expect(fly(0.33, 5).apogeeM).toBeGreaterThan(20);
    expect(fly(0.33, 5).apogeeM).toBeLessThan(120);
  });
  it('beats 10% and 80% with a third full at the same pressure', () => {
    expect(fly(1 / 3, 5).apogeeM).toBeGreaterThan(fly(0.1, 5).apogeeM);
    expect(fly(1 / 3, 5).apogeeM).toBeGreaterThan(fly(0.8, 5).apogeeM);
  });
  it('lets the seal go above 6.5 bar and not at it, and reports the pressure', () => {
    expect(BURST_BAR).toBe(6.5);
    const go = (strokes: number) =>
      session('launch-stand', [['fill', 33], ['pump', strokes], ['tilt', 70], ['launch']]).reading;
    expect(go(26)).toMatch(
      /\(6\.50 bar\).*rose [\d.]+ m, flew [\d.]+ s and landed [\d.]+ m away toward \d+ degrees/,
    );
    expect(go(27)).toMatch(/seal let go/);
  });
  it('is carried downwind in a wind', () => {
    const still = fly(0.33, 4, 90);
    const blown = flyRocket({
      fillFraction: 0.33,
      gaugeBar: 4,
      tiltDeg: 90,
      headingDeg: 300,
      windSpeed: 6,
      windBearingDeg: 90,
      airTempC: 12,
    });
    expect(Math.hypot(still.x, still.z)).toBeLessThan(1);
    expect(blown.x).toBeGreaterThan(10);
  });
});

describe('microscopy: real sizes', () => {
  const look = (pick: number, power: number) =>
    session('specimen-tray', [['pick', pick], ['power', power], ['look']]).reading;
  it('counts stomata in proportion to the area of the round field, from 20 times', () => {
    expect(look(2, 15)).not.toMatch(/stomata/);
    const count = (power: number) => first(look(2, power), /(\d+) stomata/);
    const width = (power: number) => first(look(2, power), /field ([\d.]+) mm wide/);
    const area = (power: number) => (Math.PI / 4) * width(power) ** 2;
    for (const power of [20, 30, 50])
      expect(Math.abs(count(power) / area(power) - 180) / 180).toBeLessThan(0.1);
    expect(count(20) / count(40)).toBeGreaterThan(3.4);
    expect(count(20) / count(40)).toBeLessThan(4.6);
  });
  it('resolves each structure only above its own power', () => {
    expect(look(1, 2)).toMatch(/barbs/);
    expect(look(1, 10)).not.toMatch(/barbules/);
    expect(look(1, 16)).toMatch(/barbules/);
    expect(look(3, 4)).not.toMatch(/grains/);
    expect(look(3, 5)).toMatch(/grains/);
    expect(look(4, 30)).not.toMatch(/ridges/);
    expect(look(4, 40)).toMatch(/ridges on a scale/);
    expect(look(5, 20)).toMatch(/slipper-shaped swimmers/);
    expect(look(5, 20)).not.toMatch(/green cells/);
    expect(look(5, 30)).toMatch(/smaller green cells/);
    expect(look(6, 9)).not.toMatch(/fibres/);
    expect(look(6, 10)).toMatch(/fibres/);
    expect(look(6, 60)).toMatch(/field 0\.3 mm wide/);
    expect(operate(object('specimen-tray'), 'power', 61, undefined, noon).ok).toBe(false);
  });
});

describe('garden: runner beans', () => {
  it('shows heights in cm with one decimal while under 30 cm, and levels off near 300', () => {
    const { state } = session('garden', [
      ['water', 2],
      ['shade', 0],
    ]);
    const early = use('garden', state, 'measure', undefined, noon + 2 * DAY).reading;
    expect(early).toMatch(/seedling 1 stands \d+\.\d cm/);
    const late = use('garden', state, 'measure', undefined, noon + 3000 * DAY).reading;
    for (const m of late.matchAll(/stands (\d+) cm/g))
      expect(Number(m[1])).toBeLessThanOrEqual(300);
    expect(late).not.toMatch(/stands \d+\.\d cm/);
  });
});
