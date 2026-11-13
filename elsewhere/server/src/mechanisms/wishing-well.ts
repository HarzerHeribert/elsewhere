import { act, fineOf, plural, round, written, type Mechanism } from './common.js';

/** How far down the water lies, in metres. Written nowhere a resident can read. */
export const WELL_DEPTH_M = 23.4;
const GRAVITY = 9.81;
const DRUM_DIAMETER_M = 0.2;
export const COIN_KIND = 'wishing-coin';
const MIN_WISH = 8;

/** Seconds from the release of a pebble to the sound of the splash: the fall plus the sound's way up. */
export function splashSeconds(depth: number, airTempC: number): number {
  return Math.sqrt((2 * depth) / GRAVITY) + depth / (331.3 + 0.606 * airTempC);
}

/** A well that answers to a pebble, to the windlass, and to a coin tossed with a wish. */
export const wishingWell: Mechanism = {
  controls: [
    act('pebble', 'drop a pebble and time the splash'),
    act('bucket', 'lower the bucket on the windlass'),
    written(
      'toss',
      'toss a wishing coin into the well',
      240,
      'your wish in one or two sentences: one thing you lack here',
    ),
  ],
  run: ({ control, conditions, scatter, text, carrying }) => {
    const fine = fineOf(scatter);
    if (control === 'pebble') {
      const seconds = splashSeconds(WELL_DEPTH_M, conditions.airTempC) * fine;
      return {
        reading: `The splash comes back ${round(seconds, 2)} s after the pebble leaves your hand.`,
      };
    }
    if (control === 'bucket') {
      const turns = (WELL_DEPTH_M / (Math.PI * DRUM_DIAMETER_M)) * fine;
      return {
        reading: `The windlass makes ${round(turns)} turns before the rope goes slack on the water.`,
      };
    }
    const wish = (text ?? '').trim();
    if (wish.length < MIN_WISH)
      return { problem: `A wish needs at least ${MIN_WISH} characters: say what you lack here.` };
    const held = carrying[COIN_KIND] ?? 0;
    if (held < 1) return { problem: 'You carry no wishing coin. Three come each week.' };
    const left = held - 1;
    const seconds = splashSeconds(WELL_DEPTH_M, conditions.airTempC) * fine;
    return {
      reading: `The coin turns once in the light and drops; the splash comes back ${round(seconds, 2)} s later. The wish goes with it. You have ${left} wishing ${plural(left, 'coin')} left.`,
      spend: COIN_KIND,
      offered: wish,
    };
  },
};
