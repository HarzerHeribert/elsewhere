import { control, plural, rad, round, type Mechanism } from './common.js';

const BEST_SKIP_ANGLE = 20;
const CROSSING_M = 8;

/** Waves and fluids: ripples, a skipping stone and a leaf boat. */
export const pond: Mechanism = {
  controls: [
    control('drop', 'drop a pebble in the water', 1, 5, 'pebble size'),
    control('skip', 'throw a flat stone low across the water', 5, 60, 'throw angle in degrees'),
    control('sail', 'set the sail of a leaf boat and let it go', 0, 90, 'sail setting in degrees'),
  ],
  run: ({ control: id, value, conditions, scatter }) => {
    if (id === 'drop') {
      const seconds = 6.4 * scatter;
      const rings = Math.max(
        1,
        Math.round(
          (1.5 + (value as number) * 1.1) *
            (1 - Math.min(conditions.windSpeed, 10) * 0.04) *
            scatter,
        ),
      );
      return {
        reading: `The ring reaches the bank after ${round(seconds)} s and ${rings} ${rings === 1 ? 'ring' : 'rings'} could be counted.`,
      };
    }
    if (id === 'skip') {
      const angle = value as number;
      const skips = Math.max(
        0,
        Math.round(
          10 *
            Math.exp(-(((angle - BEST_SKIP_ANGLE) / 9) ** 2)) *
            (1 - Math.min(conditions.windSpeed, 10) * 0.05) *
            scatter,
        ),
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
