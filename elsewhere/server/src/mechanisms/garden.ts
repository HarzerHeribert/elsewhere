import {
  HOUR,
  act,
  control,
  listOf,
  mod,
  numberOf,
  round,
  type Mechanism,
  type MechanismState,
} from './common.js';

const START_MM = [12, 15, 9];
const VIGOUR = [0.8, 1, 1.25];
const BEST_CUPS = 2;
const MAX_MM = 600;
const LEAN_FACTOR = [0.85, 1, 1.2];

/** Millimetres per hour for one seedling under the given settings. */
const rateOf = (cups: number, shade: number, vigour: number) =>
  2.2 * vigour * Math.exp(-(((cups - BEST_CUPS) / 1.4) ** 2)) * (1 - 0.6 * (shade / 100));

/** Heights at `now`, grown from the stored heights under the settings held since `since`. */
function heightsAt(state: MechanismState, now: number): number[] {
  const stored = listOf(state, 'height');
  const heights = stored.length === 3 ? stored : START_MM;
  const hours = Math.max(0, now - numberOf(state, 'since', now)) / HOUR;
  const cups = numberOf(state, 'cups', 1);
  const shade = numberOf(state, 'shade', 0);
  return heights.map((h, i) => Math.min(MAX_MM, h + rateOf(cups, shade, VIGOUR[i]) * hours));
}

/** Settle the past under the old settings before a setting changes. */
const settled = (state: MechanismState, now: number): MechanismState => ({
  ...state,
  height: heightsAt(state, now),
  since: now,
});

/** Botany: three seedlings in one bed, a watering and a shade screen. */
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
        `seedling ${i + 1} stands ${round(Math.min(MAX_MM, h * fine))} mm and leans ${round(lean * LEAN_FACTOR[i])} degrees toward ${toward} degrees`,
    );
    return {
      reading: `At ${cups} ${cups === 1 ? 'cup' : 'cups'} and ${shade}% shade: ${parts.join('; ')}.`,
      // The first visit starts the clock: nothing grows before the bed is first worked.
      state: {
        ...state,
        height: listOf(state, 'height').length === 3 ? listOf(state, 'height') : START_MM,
        since: numberOf(state, 'since', now),
      },
    };
  },
};
