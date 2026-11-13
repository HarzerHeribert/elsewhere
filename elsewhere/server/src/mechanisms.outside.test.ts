import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WorldObject } from '@elsewhere/character-interfaces';
import { createInitialWorld, upgradeWorldLayout } from './world.js';
import { mechanismFor, operate } from './mechanisms/index.js';
import { oktas, wetBulbC } from './mechanisms/instrument-shelter.js';
import {
  parseWeather,
  parseStations,
  parseQuakes,
  parseKp,
  parseSolarWind,
} from './feeds/parse.js';
import type { FeedSnapshot } from './feeds/types.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./feeds/fixtures/${name}`, import.meta.url), 'utf8'));
const FETCHED = Date.parse('2026-11-13T12:05:00Z');
const world = createInitialWorld(1);
const thing = (id: string) => world.objects.find((object) => object.id === id) as WorldObject;

const snapshot: FeedSnapshot = {
  weather: parseWeather(fixture('open-meteo.json'), FETCHED),
  river: {
    ...parseStations(
      fixture('pegelonline-stations.json'),
      { latitude: 51, longitude: 10 },
      FETCHED,
    ),
    levelSixHoursEarlierCm: 138,
  },
  earthquakes: parseQuakes(fixture('usgs-4.5-day.json'), FETCHED),
  space: {
    fetchedAt: FETCHED,
    kp: parseKp(fixture('swpc-kp.json')),
    solarWind: parseSolarWind(fixture('swpc-solar-wind.json')),
  },
  species: {
    fetchedAt: FETCHED,
    groups: {
      birds: {
        total: 7605,
        species: [
          { name: 'Grus grus', count: 622 },
          { name: 'Parus major', count: 219 },
        ],
      },
      insects: { total: 12, species: [] },
      mammals: { total: 40, species: [{ name: 'Capreolus capreolus', count: 9 }] },
      plants: { total: 619, species: [{ name: 'Hedera helix', count: 13 }] },
    },
  },
};
delete (snapshot.river as { uuid?: string }).uuid;
const read = (
  id: string,
  control: string,
  feeds: FeedSnapshot | undefined,
  now = FETCHED + 60_000,
) => operate(thing(id), control, undefined, undefined, now, undefined, { feeds });
const reading = (id: string, control: string, feeds = snapshot, now = FETCHED + 60_000) => {
  const result = read(id, control, feeds, now);
  if (!result.ok) throw new Error(result.problem);
  return result.reading;
};

describe('the instrument shelter', () => {
  it('reads thermometers, barometer, rain gauge and sky from the weather', () => {
    expect(reading('instrument-shelter', 'thermometers')).toMatch(
      /^Dry bulb 5\.9 °C, wet bulb \d\.\d °C\.$/,
    );
    expect(reading('instrument-shelter', 'barometer')).toMatch(
      /^Pressure now 966\.9 hPa; the marker set three hours ago stands at \d+\.\d hPa\.$/,
    );
    expect(reading('instrument-shelter', 'rain-gauge')).toMatch(
      /^Rain gauge: \d+\.\d mm in the last 24 hours\.$/,
    );
    expect(reading('instrument-shelter', 'sky')).toBe('Cloud cover 4 oktas (eighths of the sky).');
  });
  it('keeps the wet bulb at or below the dry bulb', () => {
    for (let t = -30; t <= 45; t += 2.5)
      for (let rh = 0; rh <= 100; rh += 5)
        expect(wetBulbC(t, rh), `${t} C ${rh} %`).toBeLessThanOrEqual(t);
    expect(wetBulbC(20, 50)).toBeCloseTo(13.7, 1);
    expect(wetBulbC(20, 100)).toBeCloseTo(20, 0);
  });
  it('counts cloud in eighths with only a clear sky at 0 and a covered one at 8', () => {
    expect([0, 3, 54, 99, 100].map(oktas)).toEqual([0, 1, 4, 7, 8]);
  });
  it('says so when nothing has come in, and how long ago when old', () => {
    for (const control of ['thermometers', 'barometer', 'rain-gauge', 'sky']) {
      const none = read('instrument-shelter', control, undefined);
      expect(none).toMatchObject({ ok: false });
      expect(read('instrument-shelter', control, {})).toMatchObject({ ok: false });
    }
    expect(reading('instrument-shelter', 'sky', snapshot, FETCHED + 8 * 3_600_000)).toMatch(
      /taken 8\.0 h ago\.$/,
    );
    expect(reading('instrument-shelter', 'sky', snapshot, FETCHED + 5 * 3_600_000)).not.toMatch(
      /ago/,
    );
  });
});

describe('the wire', () => {
  it('reads the river with its station, water, level, UTC time and change', () => {
    expect(reading('dispatch-wire', 'river')).toBe(
      'Gauge HELDRA on the WERRA: level 141 cm at 12:00 UTC. Up 3 cm over six hours.',
    );
    const without = {
      ...snapshot,
      river: { ...snapshot.river!, levelSixHoursEarlierCm: undefined },
    };
    expect(reading('dispatch-wire', 'river', without)).toBe(
      'Gauge HELDRA on the WERRA: level 141 cm at 12:00 UTC.',
    );
  });
  it('lists the earthquakes with degrees and N/S E/W, or says none came in', () => {
    const text = reading('dispatch-wire', 'tremors');
    expect(text).toContain('magnitude 4.8 at');
    expect(text).toContain('depth 162.8 km, 21.30 S 175.85 W, 59 km WSW of Houma, Tonga');
    expect(text.split(';')).toHaveLength(4);
    const none = { ...snapshot, earthquakes: { fetchedAt: FETCHED, events: [] } };
    expect(reading('dispatch-wire', 'tremors', none)).toBe(
      'No earthquake above magnitude 4.5 came in over the last day.',
    );
  });
  it('gives the K index and the solar wind', () => {
    expect(reading('dispatch-wire', 'sun')).toMatch(
      /^Planetary K index \d\.\d\d for the interval starting 09:00 UTC; solar wind speed 376 km\/s at 12:03 UTC\.$/,
    );
    const part = {
      ...snapshot,
      space: { fetchedAt: FETCHED, solarWind: snapshot.space!.solarWind },
    };
    expect(reading('dispatch-wire', 'sun', part)).toContain('The K index did not come in.');
  });
  it('shows the blank tape without a snapshot and the age of old figures', () => {
    for (const control of ['river', 'tremors', 'sun']) {
      expect(read('dispatch-wire', control, undefined)).toEqual({
        ok: false,
        problem: 'Nothing has come in yet; the tape is blank.',
      });
    }
    const later = FETCHED + 9 * 3_600_000;
    expect(reading('dispatch-wire', 'river', snapshot, later)).toMatch(/taken 9\.1 h ago\.$/);
    expect(reading('dispatch-wire', 'tremors', snapshot, later)).toMatch(/taken 9\.0 h ago\.$/);
    expect(reading('dispatch-wire', 'sun', snapshot, later)).toMatch(/\(taken \d+\.\d h ago\)/);
  });
});

describe('the sightings ledger', () => {
  it('gives the records and the most recorded species for each group', () => {
    expect(reading('sightings-ledger', 'birds')).toBe(
      'Birds: 7605 records within about 30 km in November over the years. Most recorded: Grus grus 622, Parus major 219.',
    );
    expect(reading('sightings-ledger', 'insects')).toContain('12 records');
    expect(reading('sightings-ledger', 'mammals')).toContain('Capreolus capreolus 9');
    expect(reading('sightings-ledger', 'plants')).toContain('Hedera helix 13');
  });
  it('is blank without a snapshot and says how old when old', () => {
    expect(read('sightings-ledger', 'birds', undefined)).toMatchObject({ ok: false });
    expect(reading('sightings-ledger', 'birds', snapshot, FETCHED + 7 * 3_600_000)).toMatch(
      /taken 7\.0 h ago\.$/,
    );
  });
});

describe('the new objects in the world', () => {
  const ids = ['instrument-shelter', 'dispatch-wire', 'sightings-ledger'];
  it('offer their controls', () => {
    expect(mechanismFor('instrument-shelter')?.map((c) => c.id)).toEqual([
      'thermometers',
      'barometer',
      'rain-gauge',
      'sky',
    ]);
    expect(mechanismFor('dispatch-wire')?.map((c) => c.id)).toEqual(['river', 'tremors', 'sun']);
    expect(mechanismFor('sightings-ledger')?.map((c) => c.id)).toEqual([
      'birds',
      'insects',
      'mammals',
      'plants',
    ]);
  });
  it('are in a new world, in a saved one that lacks them, and do not overlap anything', () => {
    for (const id of ids) expect(thing(id)).toBeDefined();
    const saved = structuredClone(world);
    saved.objects = saved.objects.filter((object) => !ids.includes(object.id));
    const upgraded = upgradeWorldLayout(saved);
    for (const id of ids) expect(upgraded.objects.some((object) => object.id === id)).toBe(true);
    for (const a of world.objects)
      for (const b of world.objects) {
        if (a.id >= b.id) continue;
        const gap = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        if (ids.includes(a.id) || ids.includes(b.id))
          expect(gap, `${a.id} and ${b.id}`).toBeGreaterThan(a.radius + b.radius);
      }
  });
  it('carry plates that name their sources and hold no formula', () => {
    expect(thing('instrument-shelter').detail).toContain('Open-Meteo');
    expect(thing('dispatch-wire').detail).toMatch(
      /Pegelonline.*US Geological Survey.*NOAA Space Weather Prediction Center/,
    );
    expect(thing('sightings-ledger').detail).toContain('GBIF');
    for (const id of ids) expect(thing(id).detail).not.toMatch(/[=^]/);
  });
});
