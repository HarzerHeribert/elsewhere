import { act, bearingOf, control, hash, numberOf, rad, round, type Mechanism } from './common.js';

const GRAVITY = 9.81;
const MAX_STROKES = 60;
/** Hidden: the bottle points this way. */
const HEADING = 300;

/** Rocketry: a water rocket that is filled, pumped, tilted and launched once. */
export const launchStand: Mechanism = {
  controls: [
    control('fill', 'fill the bottle with water', 0, 100, 'percent of the bottle filled'),
    control('pump', 'work the pump', 1, 30, 'strokes of the pump'),
    control('tilt', 'tilt the stand', 30, 90, 'angle from the ground in degrees'),
    act('launch', 'pull the release'),
  ],
  run: ({ control: id, value, state, conditions, scatter, object }) => {
    const fill = numberOf(state, 'fill', 0);
    const strokes = numberOf(state, 'strokes', 0);
    const tilt = numberOf(state, 'tilt', 60);
    if (id === 'fill')
      return {
        reading: `The bottle now holds ${value}% water.`,
        state: { ...state, fill: value as number },
      };
    if (id === 'pump') {
      const total = Math.min(MAX_STROKES, strokes + (value as number));
      return {
        reading: `${value} ${value === 1 ? 'stroke' : 'strokes'} pumped; ${total} ${total === 1 ? 'stroke' : 'strokes'} are in the bottle now.`,
        state: { ...state, strokes: total },
      };
    }
    if (id === 'tilt')
      return {
        reading: `The stand is now tilted to ${value} degrees.`,
        state: { ...state, tilt: value as number },
      };
    const emptied = { ...state, fill: 0, strokes: 0 };
    const head = `With ${fill}% water, ${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} and a tilt of ${tilt} degrees`;
    const limit = 26 + Math.round(2 * (hash(`${object.id}:seal`) - 0.5));
    if (strokes > limit)
      return {
        reading: `${head} the seal let go on the stand and the water ran out; nothing flew.`,
        state: emptied,
      };
    if (fill <= 0 || strokes <= 0)
      return {
        reading: `${head} the rocket only tipped over on the stand.`,
        state: emptied,
      };
    const f = fill / 100;
    const speed = 1.45 * strokes ** 0.9 * Math.exp(-(((f - 1 / 3) / 0.25) ** 2)) * scatter;
    const sine = Math.sin(rad(tilt));
    const flight = (2 * speed * sine) / GRAVITY;
    const height = (speed * sine) ** 2 / (2 * GRAVITY);
    const range = (speed ** 2 * Math.sin(2 * rad(tilt))) / GRAVITY;
    const drift = conditions.windSpeed * 0.6 * flight;
    const x = range * Math.sin(rad(HEADING)) + drift * Math.sin(rad(conditions.windBearingDeg));
    const z = -range * Math.cos(rad(HEADING)) - drift * Math.cos(rad(conditions.windBearingDeg));
    const away = Math.hypot(x, z);
    return {
      reading: `${head} the rocket rose ${round(height)} m, flew ${round(flight)} s and landed ${round(away)} m away toward ${Math.round(bearingOf(x, z))} degrees.`,
      state: emptied,
    };
  },
};
