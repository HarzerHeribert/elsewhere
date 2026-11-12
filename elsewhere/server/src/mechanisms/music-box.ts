import { act, control, listOf, numberOf, round, type Mechanism } from './common.js';

const STEPS = 16;
/** Middle C in Hz; the comb is tuned to C major in equal temperament from here. */
const C4 = 261.63;
/** Semitones above C4 of each of the eight teeth: C D E F G A B C. */
const SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12];
export const TEETH = SEMITONES.map((semitones) => C4 * 2 ** (semitones / 12));
/** Interval sizes in semitones that ring cleanly: unison, thirds, fourth, fifth, sixths, octave. */
const CLEAN_SEMITONES = [0, 3, 4, 5, 7, 8, 9, 12];

/** Whether two frequencies make a clean interval, judged from their ratio. */
export const cleanPair = (a: number, b: number) => {
  const semitones = Math.round(12 * Math.log2(Math.max(a, b) / Math.min(a, b)));
  return CLEAN_SEMITONES.includes(semitones);
};

/** Composition: a pinned cylinder of 16 steps played against a steel comb of eight teeth. */
export const musicBox: Mechanism = {
  controls: [
    control('step', 'turn the cylinder to one step', 1, STEPS, 'step number'),
    control(
      'note',
      'pin a tooth at the chosen step, or leave a rest',
      0,
      8,
      'tooth number, 0 for a rest',
    ),
    control('tempo', 'set the governor', 40, 200, 'steps per minute'),
    act('play', 'let the cylinder turn once and listen'),
  ],
  run: ({ control: id, value, state }) => {
    const stored = listOf(state, 'notes');
    const notes = stored.length === STEPS ? stored : new Array<number>(STEPS).fill(0);
    const picked = numberOf(state, 'step', 1);
    if (id === 'step')
      return {
        reading: `The cylinder is turned to step ${value}.`,
        state: { ...state, step: value as number },
      };
    if (id === 'note') {
      const next = notes.slice();
      next[picked - 1] = value as number;
      return {
        reading: value
          ? `Step ${picked} is pinned for tooth ${value}.`
          : `Step ${picked} is left as a rest.`,
        state: { ...state, notes: next },
      };
    }
    if (id === 'tempo')
      return {
        reading: `The governor is set to ${value} steps per minute.`,
        state: { ...state, tempo: value as number },
      };
    const tempo = numberOf(state, 'tempo', 120);
    const seconds = (STEPS * 60) / tempo;
    const sounded: string[] = [];
    notes.forEach((tooth, i) => {
      if (tooth > 0) sounded.push(`step ${i + 1} ${round(TEETH[tooth - 1])} Hz`);
    });
    if (!sounded.length)
      return {
        reading: `At ${tempo} steps per minute the cylinder turns for ${round(seconds)} s and every step is a rest.`,
      };
    const pairs: string[] = [];
    for (let i = 0; i + 1 < STEPS; i++)
      if (notes[i] > 0 && notes[i + 1] > 0)
        pairs.push(
          `steps ${i + 1} and ${i + 2} ${cleanPair(TEETH[notes[i] - 1], TEETH[notes[i + 1] - 1]) ? 'ring cleanly' : 'beat roughly'}`,
        );
    return {
      reading: `At ${tempo} steps per minute the cylinder turns for ${round(seconds)} s and plays ${sounded.join(', ')}${pairs.length ? `; ${pairs.join(', ')}` : ''}.`,
    };
  },
};
