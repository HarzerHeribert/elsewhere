import { act, control, numberOf, plural, round, scatterOf, type Mechanism } from './common.js';

/** Tube lengths in cm as hung; the collar can move the sounding length by up to 3 cm. */
const TUBE_CM = [40, 34.4, 30.4, 27.2, 24.8];
const K = 400;
const THRESHOLDS = [4.5, 3.6, 2.8, 2.0, 1.2];
/** Positive shift moves the collar so that less of the tube sounds. */
const soundingCm = (tube: number, state: Record<string, unknown>) =>
  TUBE_CM[tube - 1] -
  (typeof state[`shift${tube}`] === 'number' ? (state[`shift${tube}`] as number) : 0) / 10;

/** Acoustics and tuning: five tubes whose pitch and ring depend on how much of them sounds. */
export const windchime: Mechanism = {
  controls: [
    control('strike', 'strike one tube', 1, 5, 'tube number'),
    act('listen', 'listen to the chime for ten seconds'),
    control('pick', 'pick one tube to work on', 1, 5, 'tube number'),
    act('measure', 'measure the picked tube with a rule'),
    control('shift', 'slide the collar of the picked tube', -30, 30, 'collar shift in mm'),
  ],
  run: ({ control: id, value, state, conditions, scatter, object }) => {
    const picked = numberOf(state, 'pick', 1);
    if (id === 'pick') {
      return { reading: `Tube ${value} is picked.`, state: { ...state, pick: value as number } };
    }
    if (id === 'shift') {
      return {
        reading: `The collar of tube ${picked} now sits at a shift of ${value} mm.`,
        state: { ...state, [`shift${picked}`]: value as number },
      };
    }
    if (id === 'measure') {
      const cm = soundingCm(picked, state) + (scatter - 1) * 2.5;
      return { reading: `Tube ${picked} sounds along ${round(cm)} cm.` };
    }
    if (id === 'strike') {
      const length = soundingCm(value as number, state) / 40;
      const pitch = (K / length ** 2) * scatter;
      const ring = (8 * length ** 1.5 * scatter) / (1 + 0.15 * conditions.windSpeed);
      return { reading: `The tube rings at ${round(pitch, 0)} Hz for ${round(ring)} s.` };
    }
    const uses = numberOf(state, 'uses', 0);
    const rang: string[] = [];
    THRESHOLDS.forEach((threshold, index) => {
      if (conditions.windSpeed <= threshold) return;
      const times = Math.max(
        1,
        Math.round(
          (conditions.windSpeed - threshold) * 1.5 * scatterOf(object.id, `tube${index}`, uses),
        ),
      );
      rang.push(`tube ${index + 1} ${times} ${plural(times, 'time')}`);
    });
    return {
      reading: rang.length
        ? `In ten seconds the wind rang ${rang.join(', ')}.`
        : 'In ten seconds none of the tubes rang.',
    };
  },
};
