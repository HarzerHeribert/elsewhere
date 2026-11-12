import {
  act,
  ago,
  listOf,
  plural,
  round,
  shadowOf,
  type Mechanism,
  type MechanismState,
} from './common.js';

const MAX_MARKS = 24;

/** Timekeeping: a horizontal dial with a vertical pin; marks are scratched at the shadow tip. */
export const sundial: Mechanism = {
  controls: [
    act('read', 'read the shadow of the pointer'),
    act('mark', 'scratch a mark on the dial at the tip of the shadow'),
    act('marks', 'look over the marks scratched on the dial'),
    act('clear', 'rub every mark off the dial'),
  ],
  run: ({ control, conditions, scatter, state, now }) => {
    const shadow = conditions.sunElevationDeg >= 2 ? shadowOf(conditions, scatter) : undefined;
    if (control === 'read') {
      return {
        reading: shadow
          ? `The shadow is ${round(shadow.length)} cm long and falls toward ${shadow.falls} degrees.`
          : 'No shadow falls on the dial.',
      };
    }
    const marks = listOf(state, 'marks');
    if (control === 'mark') {
      if (!shadow) return { problem: 'There is no shadow to mark on the dial now.' };
      const length = Math.round(shadow.length * 10) / 10;
      const next = [...marks, length, shadow.falls, now].slice(-3 * MAX_MARKS);
      const next_state: MechanismState = { ...state, marks: next };
      return {
        reading: `A mark is scratched at the shadow tip, ${round(length)} cm out toward ${shadow.falls} degrees; the dial now carries ${next.length / 3} ${plural(next.length / 3, 'mark')}.`,
        state: next_state,
      };
    }
    if (control === 'clear') {
      return {
        reading: marks.length
          ? `All ${marks.length / 3} ${plural(marks.length / 3, 'mark')} are rubbed off the dial.`
          : 'The dial was already bare.',
        state: { ...state, marks: [] },
      };
    }
    if (!marks.length) return { reading: 'The dial carries no marks.' };
    const lines: string[] = [];
    for (let i = 0; i < marks.length; i += 3)
      lines.push(
        `mark ${i / 3 + 1}: ${round(marks[i])} cm toward ${marks[i + 1]} degrees, made ${ago(now - marks[i + 2])}`,
      );
    return { reading: `The dial carries ${lines.join('; ')}.` };
  },
};
