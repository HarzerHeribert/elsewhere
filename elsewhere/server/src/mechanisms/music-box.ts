import { act, control, listOf, numberOf, round, type Mechanism } from './common.js';

const STEPS = 16;
/** Hidden: the pitch in Hz of each tooth of the comb. */
const TEETH = [220, 247.5, 264, 293.3, 330, 352, 396, 440];
/** Ratios that ring cleanly together. */
const SIMPLE = [1, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 2];

const cleanPair = (a: number, b: number) => {
  const ratio = Math.max(a, b) / Math.min(a, b);
  return SIMPLE.some((simple) => Math.abs(ratio - simple) / simple < 0.012);
};

/** Composition: a pinned cylinder of 16 steps played against a comb of eight teeth. */
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
