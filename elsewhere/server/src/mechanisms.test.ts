import { describe, expect, it } from 'vitest';
import { createInitialWorld } from './world.js';
import { mechanismFor, operate, worldConditions, type MechanismState } from './mechanisms/index.js';

const world = createInitialWorld(0);
const object = (id: string) => world.objects.find((item) => item.id === id)!;
const HOUR = 3_600_000;
const day = Date.UTC(2026, 10, 9, 0, 0);
const noon = day + 12 * HOUR;
const midnight = day;
const read = (id: string, control: string, value?: number, state?: MechanismState, at = noon) => {
  const result = operate(object(id), control, value, state, at);
  if (!result.ok) throw new Error(result.problem);
  return result;
};
const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('world conditions', () => {
  it('are deterministic, smooth and differ over hours more than minutes', () => {
    expect(worldConditions(noon)).toEqual(worldConditions(noon));
    const a = worldConditions(noon);
    const minutes = worldConditions(noon + 5 * 60_000);
    const hours = worldConditions(noon + 5 * HOUR);
    expect(Math.abs(a.airTempC - minutes.airTempC)).toBeLessThan(
      Math.abs(a.airTempC - hours.airTempC),
    );
    for (let i = 0; i < 200; i++)
      expect(worldConditions(day + i * 0.37 * HOUR).windSpeed).toBeGreaterThanOrEqual(0);
  });
});

describe('mechanisms', () => {
  it('give equal readings for equal inputs', () => {
    expect(operate(object('windchime'), 'strike', 3, undefined, noon)).toEqual(
      operate(object('windchime'), 'strike', 3, undefined, noon),
    );
  });

  it('have chime pitch rise with the tube number', () => {
    const pitches = [1, 2, 3, 4, 5].map(
      (tube) => numbers(read('windchime', 'strike', tube).reading)[0],
    );
    expect(pitches).toEqual([...pitches].sort((x, y) => x - y));
    expect(pitches[0]).toBeGreaterThan(350);
    expect(pitches[4]).toBeLessThan(1150);
  });

  it('remembers the cord length and the bob, and forgets what the old vane kept', () => {
    const longer = read('artifact', 'length', 150);
    const heavier = read('artifact', 'bob', 5, longer.state);
    expect(heavier.state).toMatchObject({ length: 150, bob: 5 });
    const old = read('artifact', 'length', 80, { fin: 7, uses: 2 });
    expect(old.state).not.toHaveProperty('fin');
    expect(read('artifact', 'release', 10, heavier.state).reading).toMatch(
      /Released from 10 degrees with the 500 g bob on 150 cm of cord, ten full swings took [\d.]+ s/,
    );
  });

  it('casts no shadow at night and different shadows at different hours', () => {
    expect(read('sundial', 'read', undefined, undefined, midnight).reading).toMatch(/No shadow/);
    const lengths = [10, 12, 15].map(
      (hour) =>
        numbers(read('sundial', 'read', undefined, undefined, day + hour * HOUR).reading)[0],
    );
    expect(new Set(lengths).size).toBe(3);
    expect(lengths[1]).toBeLessThan(lengths[0]);
  });

  it('has the telescope peak near its best focus, which moves with the time of day', () => {
    const craters = (value: number, at: number) =>
      numbers(read('lookout-telescope', 'focus', value, undefined, at).reading)[0];
    const sweep = (at: number) => {
      const scores = Array.from({ length: 101 }, (_, value) => craters(value, at));
      return { best: scores.indexOf(Math.max(...scores)), top: Math.max(...scores) };
    };
    const night = sweep(midnight + HOUR);
    expect(
      Math.abs(night.best - (58 + 0.9 * (worldConditions(midnight + HOUR).airTempC - 12))),
    ).toBeLessThan(4);
    expect(sweep(noon).top).toBeLessThan(night.top);
    const later = sweep(midnight + 8 * HOUR + 17 * 60_000);
    expect(later.best).not.toBe(night.best);
  });

  it('has bigger pebbles start longer ripples, and reports the spacing, speed and time to the bank', () => {
    const reading = read('pond-water', 'drop', 3).reading;
    expect(reading).toMatch(/rings lie [\d.]+ cm apart.*[\d.]+ cm\/s.*2\.0 m away after [\d.]+ s/);
    const spacing = (size: number) => numbers(read('pond-water', 'drop', size).reading)[0];
    expect(spacing(5)).toBeGreaterThan(spacing(1));
  });

  it('reads the flag, the stones and the chime in the air', () => {
    expect(read('weather-marker', 'read').reading).toMatch(/limp|flicks/);
    expect(read('standing-stones', 'tap', 3).reading).toMatch(/Hz/);
    expect(read('windchime', 'listen').reading).toMatch(/rang|none/);
  });

  it('refuses an unknown control or a value out of range with a helpful problem', () => {
    const unknown = operate(object('windchime'), 'pluck', undefined, undefined, noon);
    expect(unknown).toMatchObject({ ok: false });
    expect(!unknown.ok && unknown.problem).toMatch(/strike, listen, pick, measure, shift/);
    const range = operate(object('windchime'), 'strike', 9, undefined, noon);
    expect(!range.ok && range.problem).toMatch(/1 to 5/);
    expect(operate(object('windchime'), 'strike', undefined, undefined, noon).ok).toBe(false);
    expect(operate(object('windchime'), 'strike', 2.5, undefined, noon).ok).toBe(false);
  });

  it('lists controls only for objects that can be worked, without saying what governs them', () => {
    expect(mechanismFor('bench')).toBeUndefined();
    const text = JSON.stringify(
      ['sundial', 'windchime', 'weather-marker', 'artifact', 'pond', 'telescope', 'stones'].map(
        mechanismFor,
      ),
    );
    expect(text).not.toMatch(/wind speed|temperature|threshold|angle of|sun/i);
  });
});
