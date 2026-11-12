import { control, fineOf, plural, rad, round, type Mechanism } from './common.js';

const BEST_SKIP_ANGLE = 20;
const CROSSING_M = 8;
const BANK_M = 2;
const GRAVITY = 9.81;
const SURFACE_TENSION = 0.0728;
const WATER_DENSITY = 1000;
/** Dominant ripple wavelength in cm for each pebble size. */
export const WAVELENGTH_CM = [0.6, 1.2, 1.7, 3.5, 7];

/** Speed in cm/s of a ripple of `wavelengthCm`: capillary-gravity waves on deep water. */
export function rippleSpeed(wavelengthCm: number): number {
  const lambda = wavelengthCm / 100;
  return (
    100 *
    Math.sqrt(
      (GRAVITY * lambda) / (2 * Math.PI) +
        (2 * Math.PI * SURFACE_TENSION) / (WATER_DENSITY * lambda),
    )
  );
}

/** Stones skip best at a shallow angle and not at all once the throw is steep. */
export function skipsAt(angle: number): number {
  if (angle >= 45) return 0;
  const shape =
    angle <= BEST_SKIP_ANGLE
      ? Math.exp(-(((angle - BEST_SKIP_ANGLE) / 12) ** 2))
      : ((45 - angle) / (45 - BEST_SKIP_ANGLE)) ** 1.5;
  return 10 * shape;
}

/** Waves and fluids: ripples, a skipping stone and a leaf boat. */
export const pond: Mechanism = {
  controls: [
    control('drop', 'drop a pebble in the water', 1, 5, 'pebble size'),
    control(
      'skip',
      'throw a flat stone low across the water',
      5,
      60,
      'angle in degrees between the stone’s face and the water',
    ),
    control('sail', 'set the sail of a leaf boat and let it go', 0, 90, 'sail setting in degrees'),
  ],
  run: ({ control: id, value, conditions, scatter }) => {
    if (id === 'drop') {
      const lambda = WAVELENGTH_CM[(value as number) - 1] * fineOf(scatter);
      const speed = rippleSpeed(lambda);
      const seconds = (BANK_M * 100) / speed;
      return {
        reading: `The rings lie ${round(lambda)} cm apart; the first ring travels at ${round(speed)} cm/s and reaches the bank ${BANK_M.toFixed(1)} m away after ${round(seconds)} s.`,
      };
    }
    if (id === 'skip') {
      const angle = value as number;
      const skips = Math.max(
        0,
        Math.round(skipsAt(angle) * (1 - Math.min(conditions.windSpeed, 10) * 0.05) * scatter),
      );
      return {
        reading: `At ${angle} degrees the stone skipped ${skips} ${plural(skips, 'time')}.`,
      };
    }
    const sail = value as number;
    const wind = conditions.windSpeed;
    const drive = wind * Math.sin(2 * rad(sail));
    const speed = (0.12 + 0.11 * Math.max(0, drive)) * scatter;
    const seconds = CROSSING_M / speed;
    const along =
      seconds *
        0.05 *
        wind *
        Math.sin(rad(conditions.windBearingDeg - 90)) *
        (1 + 0.5 * Math.cos(rad(sail))) +
      (sail - 45) * 0.03;
    const side =
      Math.abs(along) < 0.05
        ? 'where it was aimed'
        : `${round(Math.abs(along))} m ${along > 0 ? 'down' : 'up'} the bank from where it was aimed`;
    return {
      reading: `With the sail at ${sail} degrees the leaf boat crossed in ${round(seconds)} s and landed ${side}.`,
    };
  },
};
