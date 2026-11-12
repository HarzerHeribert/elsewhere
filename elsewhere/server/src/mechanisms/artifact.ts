import { control, fineOf, numberOf, rad, round, type Mechanism } from './common.js';

/** Standard acceleration of free fall at the stand, in m/s^2. */
export const GRAVITY_MS2 = 9.811;
/** The five brass bobs, in grams. */
export const BOB_GRAMS = [50, 100, 200, 350, 500];
const DEFAULT_LENGTH = 100;
const DEFAULT_BOB = 3;

/** Period in seconds of a pendulum of `lengthCm`, released from `amplitudeDeg`. */
export function pendulumPeriod(lengthCm: number, amplitudeDeg: number): number {
  const theta = rad(amplitudeDeg);
  return (
    2 *
    Math.PI *
    Math.sqrt(lengthCm / 100 / GRAVITY_MS2) *
    (1 + theta ** 2 / 16 + (11 * theta ** 4) / 3072)
  );
}

/** Swings after which the swing has shrunk to half: heavier bobs cut through the air longer. */
export const swingsToHalf = (grams: number, amplitudeDeg: number) =>
  Math.max(1, Math.round(40 * (grams / 200) ** (1 / 3) * (20 / amplitudeDeg) ** 0.3));

/** Mechanics: a cord, five brass bobs and a protractor arc on a stand. */
export const artifact: Mechanism = {
  controls: [
    control('length', 'set the length of the cord', 10, 200, 'cord length in cm'),
    control('bob', 'hang one of the five bobs on the cord', 1, 5, 'bob number'),
    control('release', 'draw the bob aside and let it swing', 2, 60, 'release angle in degrees'),
  ],
  run: ({ control: id, value, state, scatter }) => {
    // A state kept from the old vane carries no meaning here.
    const { fin: _fin, ...kept } = state as Record<string, unknown> & typeof state;
    const clean = kept as typeof state;
    const length = numberOf(clean, 'length', DEFAULT_LENGTH);
    const bob = numberOf(clean, 'bob', DEFAULT_BOB);
    if (id === 'length')
      return {
        reading: `The cord is now ${value} cm long, from the pivot to the middle of the bob.`,
        state: { ...clean, length: value as number },
      };
    if (id === 'bob')
      return {
        reading: `Bob ${value} of ${BOB_GRAMS[(value as number) - 1]} g now hangs on the cord.`,
        state: { ...clean, bob: value as number },
      };
    const angle = value as number;
    const grams = BOB_GRAMS[bob - 1];
    const ten = 10 * pendulumPeriod(length, angle) * (1 + (fineOf(scatter) - 1) * 0.6);
    const halved = Math.round(swingsToHalf(grams, angle) * scatter);
    return {
      reading: `Released from ${angle} degrees with the ${grams} g bob on ${length} cm of cord, ten full swings took ${round(ten, 2)} s, and after ${halved} swings the swing had shrunk to half.`,
      state: clean,
    };
  },
};
