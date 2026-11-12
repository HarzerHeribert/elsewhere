import {
  DAY,
  act,
  control,
  listOf,
  mod,
  numberOf,
  round,
  type Mechanism,
  type MechanismState,
} from './common.js';

/** Heights in cm of the three runner-bean seedlings when the bed is first worked. */
const START_CM = [12, 15, 9];
const VIGOUR = [0.8, 1, 1.25];
const BEST_CUPS = 2;
/** Where a runner bean's height levels off, in cm. */
const MAX_CM = 300;
/** Logistic growth rate per day at the best watering and full light: about 4.5 cm a day at its peak. */
const RATE_PER_DAY = 0.06;
const LEAN_FACTOR = [0.85, 1, 1.2];

/** Growth rate per day for one seedling under the given settings. */
const rateOf = (cups: number, shade: number, vigour: number) =>
  RATE_PER_DAY * vigour * Math.exp(-(((cups - BEST_CUPS) / 1.4) ** 2)) * (1 - 0.6 * (shade / 100));

/** Logistic growth of one height over some days. */
export const grownHeight = (height: number, rate: number, days: number) =>
  MAX_CM / (1 + (MAX_CM / height - 1) * Math.exp(-rate * days));

/** Heights at `now`, grown from the stored heights under the settings held since `since`. */
function heightsAt(state: MechanismState, now: number): number[] {
  const stored = listOf(state, 'heightCm');
  if (stored.length !== 3) return START_CM;
  const days = Math.max(0, now - numberOf(state, 'since', now)) / DAY;
  const cups = numberOf(state, 'cups', 1);
  const shade = numberOf(state, 'shade', 0);
  return stored.map((h, i) => grownHeight(h, rateOf(cups, shade, VIGOUR[i]), days));
}

/** A height in cm: one decimal while small, whole centimetres once tall. */
const heightText = (cm: number) => (cm < 30 ? round(cm) : round(cm, 0));

/** Settle the past under the old settings before a setting changes. */
const settled = (state: MechanismState, now: number): MechanismState => ({
  ...state,
  heightCm: heightsAt(state, now),
  since: now,
});

/** Botany: three runner-bean seedlings in one bed, a watering and a shade screen. */
export const garden: Mechanism = {
  controls: [
    control('water', 'set the daily watering of the bed', 0, 5, 'cups of water a day', 0.5),
    control('shade', 'set a cloth screen over the bed', 0, 100, 'screen coverage in percent'),
    act('measure', 'measure the height and the lean of each seedling'),
  ],
  run: ({ control: id, value, state, conditions, scatter, now }) => {
    if (id === 'water')
      return {
        reading: `The bed is now watered with ${value} ${value === 1 ? 'cup' : 'cups'} a day.`,
        state: { ...settled(state, now), cups: value as number },
      };
    if (id === 'shade')
      return {
        reading: `The screen over the bed now covers ${value} percent.`,
        state: { ...settled(state, now), shade: value as number },
      };
    const cups = numberOf(state, 'cups', 1);
    const shade = numberOf(state, 'shade', 0);
    const fine = 1 + (scatter - 1) / 4;
    const lean =
      (3 + 0.1 * shade) * Math.max(0.15, Math.min(1, (conditions.sunElevationDeg + 5) / 40));
    const toward = Math.round(mod(conditions.sunBearingDeg, 360));
    const parts = heightsAt(state, now).map(
      (h, i) =>
        `seedling ${i + 1} stands ${heightText(Math.min(MAX_CM, h * fine))} cm and leans ${round(lean * LEAN_FACTOR[i])} degrees toward ${toward} degrees`,
    );
    return {
      reading: `At ${cups} ${cups === 1 ? 'cup' : 'cups'} and ${shade}% shade: ${parts.join('; ')}.`,
      // The first visit starts the clock: nothing grows before the bed is first worked.
      state: {
        ...state,
        heightCm: listOf(state, 'heightCm').length === 3 ? listOf(state, 'heightCm') : START_CM,
        since: listOf(state, 'heightCm').length === 3 ? numberOf(state, 'since', now) : now,
      },
    };
  },
};
