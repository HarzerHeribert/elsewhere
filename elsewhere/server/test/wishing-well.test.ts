import { describe, expect, it } from 'vitest';
import type { CharacterCommand } from '@elsewhere/character-interfaces';
import {
  createInitialWorld,
  executeWorldCommand,
  giveItem,
  grantWeeklyCoins,
  observeWorld,
  publicWorld,
  takeItem,
  upgradeWorldLayout,
} from '../src/world.js';
import { mechanismFor, operate, worldConditions } from '../src/mechanisms/index.js';
import { fineOf, scatterOf } from '../src/mechanisms/common.js';
import { splashSeconds, WELL_DEPTH_M } from '../src/mechanisms/wishing-well.js';

const WEEK = 7 * 24 * 3_600_000;
const T0 = Date.UTC(2026, 10, 9, 12);
const coins = (world: ReturnType<typeof createInitialWorld>) =>
  world.residents[0].carrying?.find((item) => item.kind === 'wishing-coin')?.count ?? 0;
const toss = (text: string): CharacterCommand => ({
  type: 'use',
  targetId: 'wishing-well',
  control: 'toss',
  text,
});
const atTheWell = () => {
  const world = createInitialWorld(1000);
  world.residents[0].position = { x: 0, z: 11.6 };
  world.residents[0].facing = 0;
  return world;
};
const WISH = 'I would like a long tape measure to find how far apart things are.';

describe('what a resident carries', () => {
  it('gives and takes items, never above the cap', () => {
    const world = createInitialWorld(1000);
    const id = world.residents[0].id;
    const some = giveItem(world, id, 'pebble', 'pebble', 4, 5);
    expect(some.residents[0].carrying).toEqual([{ kind: 'pebble', name: 'pebble', count: 4 }]);
    expect(world.residents[0].carrying).toBeUndefined();
    expect(giveItem(some, id, 'pebble', 'pebble', 4, 5).residents[0].carrying?.[0].count).toBe(5);
    const fewer = takeItem(some, id, 'pebble')!;
    expect(fewer.residents[0].carrying?.[0].count).toBe(3);
    expect(takeItem(world, id, 'pebble')).toBeUndefined();
    expect(takeItem(world, 'nobody', 'pebble')).toBeUndefined();
  });

  it('grants three coins at first, none before a week, three after, and never over six', () => {
    let world = createInitialWorld(1000);
    const id = world.residents[0].id;
    world = grantWeeklyCoins(world, id, T0);
    expect(coins(world)).toBe(3);
    expect(world.residents[0].carrying?.[0]).toMatchObject({ name: 'wishing coin' });
    expect(world.coinGrants?.[id]).toBe(T0);
    expect(coins(grantWeeklyCoins(world, id, T0 + WEEK - 1))).toBe(3);
    world = grantWeeklyCoins(world, id, T0 + WEEK);
    expect(coins(world)).toBe(6);
    expect(world.coinGrants?.[id]).toBe(T0 + WEEK);
    expect(coins(grantWeeklyCoins(world, id, T0 + 2 * WEEK))).toBe(6);
  });

  it('is public on the resident in the snapshot and in what the resident observes', () => {
    const world = grantWeeklyCoins(createInitialWorld(1000), 'hubert', T0);
    const id = world.residents[0].id;
    expect(publicWorld(world).residents[0].carrying).toEqual([
      { kind: 'wishing-coin', name: 'wishing coin', count: 3 },
    ]);
    expect(observeWorld(world, id).carrying?.[0].count).toBe(3);
    expect(observeWorld(createInitialWorld(1000), id).carrying).toEqual([]);
  });
});

describe('the wishing well', () => {
  const well = createInitialWorld(1000).objects.find((object) => object.id === 'wishing-well')!;
  const now = 5_000_000;
  const conditions = worldConditions(now);

  it('is in a new world and a saved one, and overlaps nothing', () => {
    expect(well).toMatchObject({
      name: 'The wishing well',
      kind: 'wishing-well',
      radius: 0.9,
      height: 1.6,
      tags: ['water', 'wishes'],
      affordances: ['inspect', 'interact'],
    });
    expect(well.detail).not.toMatch(/23\.4|[=^]/);
    expect(well.detail).toContain('20 cm');
    expect(mechanismFor('wishing-well')?.map((control) => control.id)).toEqual([
      'pebble',
      'bucket',
      'toss',
    ]);
    const saved = createInitialWorld(1000);
    saved.objects = saved.objects.filter((object) => object.id !== 'wishing-well');
    const upgraded = upgradeWorldLayout(saved);
    expect(upgraded.objects.some((object) => object.id === 'wishing-well')).toBe(true);
    for (const other of createInitialWorld(1000).objects)
      if (other.id !== well.id)
        expect(
          Math.hypot(other.position.x - well.position.x, other.position.z - well.position.z),
          other.id,
        ).toBeGreaterThan(other.radius + well.radius);
  });

  it('times a pebble and counts the turns of the windlass for 23.4 m', () => {
    const fine = fineOf(scatterOf('wishing-well', 'pebble', 0));
    const seconds =
      (Math.sqrt((2 * 23.4) / 9.81) + 23.4 / (331.3 + 0.606 * conditions.airTempC)) * fine;
    expect(splashSeconds(WELL_DEPTH_M, conditions.airTempC) * fine).toBeCloseTo(seconds, 10);
    const pebble = operate(well, 'pebble', undefined, undefined, now);
    expect(pebble).toMatchObject({
      ok: true,
      reading: `The splash comes back ${seconds.toFixed(2)} s after the pebble leaves your hand.`,
    });
    const turns = (23.4 / (Math.PI * 0.2)) * fineOf(scatterOf('wishing-well', 'bucket', 0));
    expect(operate(well, 'bucket', undefined, undefined, now)).toMatchObject({
      ok: true,
      reading: `The windlass makes ${turns.toFixed(1)} turns before the rope goes slack on the water.`,
    });
  });

  it('turns a toss away without a coin or with too few words, and spends one otherwise', () => {
    const none = operate(well, 'toss', undefined, undefined, now, undefined, { text: WISH });
    expect(none).toEqual({
      ok: false,
      problem: 'You carry no wishing coin. Three come each week.',
    });
    const short = operate(well, 'toss', undefined, undefined, now, undefined, {
      text: ' tiny ',
      carrying: { 'wishing-coin': 2 },
    });
    expect(short).toMatchObject({ ok: false });
    const tossed = operate(well, 'toss', undefined, undefined, now, undefined, {
      text: `  ${WISH}  `,
      carrying: { 'wishing-coin': 2 },
    });
    expect(tossed).toMatchObject({ ok: true, spend: 'wishing-coin', offered: WISH });
    if (tossed.ok) {
      expect(tossed.reading).toMatch(
        /^The coin turns once in the light and drops; the splash comes back \d\.\d\d s later\. The wish goes with it\. You have 1 wishing coin left\.$/,
      );
      expect(tossed.reading).not.toContain('tape');
    }
    const last = operate(well, 'toss', undefined, undefined, now, undefined, {
      text: WISH,
      carrying: { 'wishing-coin': 1 },
    });
    expect(last.ok && last.reading).toContain('You have 0 wishing coins left.');
  });

  it('through the world: no coin changes nothing, a coin is spent and the words come back as offered', () => {
    const world = atTheWell();
    const refused = executeWorldCommand(world, world.residents[0].id, toss(WISH), 2000);
    expect(refused.outcome).toMatchObject({ status: 'rejected' });
    expect(refused.outcome.summary).toBe('You carry no wishing coin. Three come each week.');
    expect(refused.world.mechanisms?.['wishing-well']).toBeUndefined();
    expect(refused.outcome.offered).toBeUndefined();

    const funded = grantWeeklyCoins(atTheWell(), world.residents[0].id, T0);
    const done = executeWorldCommand(funded, funded.residents[0].id, toss(WISH), 2000);
    expect(done.outcome).toMatchObject({ status: 'completed', offered: WISH });
    expect(coins(done.world)).toBe(2);
    expect(done.outcome.summary).not.toContain('tape measure');
    expect(done.outcome.evidence).not.toContain('tape measure');
    expect(done.world.events.at(-1)?.message).not.toContain('tape measure');
    expect(coins(funded)).toBe(3);
  });
});
