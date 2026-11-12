import { act, control, numberOf, type Mechanism } from './common.js';

/** Hidden: the prism only throws a band between these settings. */
const WORKING = { min: 20, max: 72 };
/** Per colour: the smallest deviation (degrees) and the setting at which it occurs. */
const COLOURS = [
  { name: 'red', least: 31, at: 46 },
  { name: 'green', least: 32.6, at: 47 },
  { name: 'violet', least: 34.4, at: 48.2 },
];
const MM_PER_DEGREE = 22;

/** Optics and colour: a glass prism on the sill, turned and fed light through a slit. */
export const window: Mechanism = {
  controls: [
    control('turn', 'turn the prism on the sill', 0, 90, 'prism setting in degrees'),
    control('slit', 'set the width of the slit in the shutter', 1, 10, 'slit width in mm'),
    act('read', 'read the band of light on the sill'),
  ],
  run: ({ control: id, value, state, conditions, scatter }) => {
    if (id === 'turn')
      return {
        reading: `The prism is now turned to ${value} degrees.`,
        state: { ...state, turn: value as number },
      };
    if (id === 'slit')
      return {
        reading: `The slit is now ${value} mm wide.`,
        state: { ...state, slit: value as number },
      };
    const turn = numberOf(state, 'turn', 40);
    const slit = numberOf(state, 'slit', 5);
    const head = `With the prism at ${turn} degrees and a ${slit} mm slit`;
    if (conditions.sunElevationDeg < 3)
      return { reading: `${head} no band forms; no sunlight reaches the glass.` };
    if (turn < WORKING.min || turn > WORKING.max)
      return { reading: `${head} no band forms on the sill.` };
    const [red, green, violet] = COLOURS.map((colour) => {
      const deviation = colour.least + 0.018 * (turn - colour.at) ** 2;
      return Math.round(
        (MM_PER_DEGREE * (deviation - 28) + 0.6 * (conditions.sunElevationDeg - 30)) * scatter,
      );
    });
    const bright = Math.round(
      Math.min(
        100,
        95 *
          Math.exp(-(((turn - 47) / 22) ** 2)) *
          (slit / 10) ** 0.8 *
          Math.min(1, conditions.sunElevationDeg / 35) *
          scatter,
      ),
    );
    const sharp = Math.round(Math.min(100, (100 / (1 + 0.25 * (slit - 1))) * scatter));
    return {
      reading: `${head} the red edge falls ${red} mm along the sill, the green ${green} mm and the violet ${violet} mm; the band is ${bright}% bright and ${sharp}% sharp.`,
    };
  },
};
