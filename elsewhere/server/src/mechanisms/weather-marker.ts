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

/** The painted bands, 0 to 12: what the wind does on land, with the speed (m/s) each begins at. */
const BANDS: Array<{ from: number; phrase: string }> = [
  { from: 0, phrase: 'calm; smoke rises straight up' },
  { from: 0.5, phrase: 'light air; smoke drifts, vanes stay still' },
  { from: 1.6, phrase: 'light breeze; wind felt on the face, leaves rustle' },
  {
    from: 3.4,
    phrase: 'gentle breeze; leaves and twigs in constant motion, light flags stretched',
  },
  { from: 5.5, phrase: 'moderate breeze; dust and loose paper lift, small branches move' },
  { from: 8, phrase: 'fresh breeze; small leafy trees sway' },
  { from: 10.8, phrase: 'strong breeze; large branches move, wires whistle' },
  { from: 13.9, phrase: 'near gale; whole trees sway, walking against it takes effort' },
  { from: 17.2, phrase: 'gale; twigs break off, walking is hard' },
  { from: 20.8, phrase: 'strong gale; slates and chimney pots blown off' },
  { from: 24.5, phrase: 'storm; trees uprooted, much damage' },
  { from: 28.5, phrase: 'violent storm; widespread damage' },
  { from: 32.7, phrase: 'hurricane force; devastation' },
];
/** The band whose phrase fits a wind speed in m/s. */
export const bandFor = (windSpeed: number) =>
  BANDS.reduce((best, band, index) => (windSpeed >= band.from ? index : best), 0);
const bandText = (windSpeed: number) => {
  const band = bandFor(windSpeed);
  return `The painted band that fits is ${band}: ${BANDS[band].phrase}.`;
};

/** Meteorology: the flag, and a tally board of what it showed. */
export const weatherMarker: Mechanism = {
  controls: [
    act('read', 'watch the flag for ten seconds'),
    act('log', 'write what the flag shows on the tally board'),
    act('tally', 'read the tally board'),
  ],
  run: ({ control, conditions, scatter, state, now }) => {
    const limp = conditions.windSpeed < 0.5;
    const flicks = Math.round(1.8 * conditions.windSpeed * scatter);
    const points = bearing(conditions.windBearingDeg + (scatter - 1) * 100);
    if (control === 'read') {
      return {
        reading: `${
          limp
            ? 'The flag hangs limp.'
            : `The flag points toward ${points} degrees and flicks ${flicks} times in ten seconds.`
        } ${bandText(conditions.windSpeed * (1 + (scatter - 1) / 4))}`,
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
