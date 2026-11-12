import {
  act,
  ago,
  bearing,
  listOf,
  plural,
  type Mechanism,
  type MechanismState,
} from './common.js';

const MAX_LINES = 24;

/** Meteorology: the flag, and a tally board of what it showed. */
export const weatherMarker: Mechanism = {
  controls: [
    act('read', 'watch the flag for ten seconds'),
    act('log', 'write what the flag shows on the tally board'),
    act('tally', 'read the tally board'),
  ],
  run: ({ control, conditions, scatter, state, now }) => {
    const limp = conditions.windSpeed < 0.6;
    const flicks = Math.round(1.8 * conditions.windSpeed * scatter);
    const points = bearing(conditions.windBearingDeg + (scatter - 1) * 100);
    if (control === 'read') {
      return {
        reading: limp
          ? 'The flag hangs limp.'
          : `The flag points toward ${points} degrees and flicks ${flicks} times in ten seconds.`,
      };
    }
    const lines = listOf(state, 'tally');
    if (control === 'log') {
      // A limp flag is written as bearing -1 with no flicks.
      const next = [...lines, now, limp ? -1 : points, limp ? 0 : flicks].slice(-3 * MAX_LINES);
      const next_state: MechanismState = { ...state, tally: next };
      return {
        reading: limp
          ? `Written on the board: the flag hung limp. The board now has ${next.length / 3} ${plural(next.length / 3, 'line')}.`
          : `Written on the board: the flag pointed toward ${points} degrees and flicked ${flicks} times in ten seconds. The board now has ${next.length / 3} ${plural(next.length / 3, 'line')}.`,
        state: next_state,
      };
    }
    if (!lines.length) return { reading: 'The tally board is blank.' };
    const rows: string[] = [];
    for (let i = 0; i < lines.length; i += 3)
      rows.push(
        lines[i + 1] < 0
          ? `line ${i / 3 + 1}: flag limp, written ${ago(now - lines[i])}`
          : `line ${i / 3 + 1}: toward ${lines[i + 1]} degrees, ${lines[i + 2]} flicks in ten seconds, written ${ago(now - lines[i])}`,
      );
    return { reading: `The board reads ${rows.join('; ')}.` };
  },
};
