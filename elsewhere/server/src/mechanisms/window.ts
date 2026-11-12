import { act, control, deg, fineOf, numberOf, rad, type Mechanism } from './common.js';

/** Apex angle of the equilateral crown-glass prism, in degrees. */
const APEX = 60;
/** Distance from the prism to the paper screen, in mm. */
const SCREEN_MM = 500;
/** The three edges read on the screen: wavelength in nm. */
const COLOURS = [
  { name: 'red', nm: 656 },
  { name: 'green', nm: 546 },
  { name: 'violet', nm: 405 },
];

/** Refractive index of the crown glass at a wavelength in nm: n = 1.5046 + 0.00420 / lambda^2 (um). */
export const glassIndex = (nm: number) => 1.5046 + 0.0042 / (nm / 1000) ** 2;

/**
 * Deviation in degrees of a ray of `nm` entering at `incidenceDeg` through both faces, or
 * undefined where the ray cannot leave the second face (total internal reflection).
 */
export function prismDeviation(incidenceDeg: number, nm: number): number | undefined {
  const n = glassIndex(nm);
  const inside = Math.asin(Math.sin(rad(incidenceDeg)) / n);
  const second = rad(APEX) - inside;
  const sine = n * Math.sin(second);
  if (sine > 1) return undefined;
  return incidenceDeg + deg(Math.asin(sine)) - APEX;
}
/** Where the ray lands on the screen, in mm from where the undeviated beam would fall. */
export const screenPosition = (deviationDeg: number) => SCREEN_MM * Math.tan(rad(deviationDeg));

/** Optics and colour: a glass prism on the sill, turned and fed light through a slit. */
export const window: Mechanism = {
  controls: [
    control(
      'turn',
      'turn the prism on the sill',
      20,
      80,
      'angle of the light on the first face in degrees',
    ),
    control('slit', 'set the width of the slit in the shutter', 1, 10, 'slit width in mm'),
    act('read', 'read the band of light on the paper screen'),
  ],
  run: ({ control: id, value, state, conditions, scatter }) => {
    if (id === 'turn')
      return {
        reading: `The prism is now turned so the light meets its first face at ${value} degrees.`,
        state: { ...state, turn: value as number },
      };
    if (id === 'slit')
      return {
        reading: `The slit is now ${value} mm wide.`,
        state: { ...state, slit: value as number },
      };
    const turn = numberOf(state, 'turn', 50);
    const slit = numberOf(state, 'slit', 5);
    const head = `With the light meeting the prism at ${turn} degrees and a ${slit} mm slit`;
    if (conditions.sunElevationDeg < 3)
      return { reading: `${head} no band forms; no sunlight reaches the glass.` };
    const deviations = COLOURS.map((colour) => prismDeviation(turn, colour.nm));
    if (deviations.some((deviation) => deviation === undefined))
      return {
        reading: `${head} no band forms on the screen; the light is turned back inside the glass.`,
      };
    const [red, green, violet] = deviations.map((deviation) =>
      Math.round(screenPosition(deviation as number) * fineOf(scatter)),
    );
    const bright = Math.round(
      Math.min(
        100,
        95 *
          Math.exp(-(((turn - 49) / 22) ** 2)) *
          (slit / 10) ** 0.8 *
          Math.min(1, conditions.sunElevationDeg / 35) *
          scatter,
      ),
    );
    const sharp = Math.round(Math.min(100, (100 / (1 + 0.25 * (slit - 1))) * scatter));
    return {
      reading: `${head} the red edge falls ${red} mm along the screen, the green ${green} mm and the violet ${violet} mm; the band is ${bright}% bright and ${sharp}% sharp.`,
    };
  },
};
