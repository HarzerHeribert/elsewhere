import { control, round, type Mechanism } from './common.js';

const INITIAL_FIN = 7;

/** The hand-cranked vane: a bendable fin that slips and scrapes by its hidden angle. */
export const artifact: Mechanism = {
  controls: [
    control('bend', 'bend the copper fin', -10, 10, 'fin angle in degrees', 0.5),
    control('turn', 'turn the crank', 1, 20, 'crank turns'),
  ],
  run: ({ control, value, state, scatter }) => {
    const angle = typeof state.fin === 'number' ? state.fin : INITIAL_FIN;
    if (control === 'bend') {
      return {
        reading: `The fin now sits at ${round(value as number)} degrees.`,
        state: { ...state, fin: value as number },
      };
    }
    const turns = value as number;
    const size = Math.abs(angle);
    const slip = size <= 2.5 ? 0 : Math.min(0.9, (size - 2.5) * 0.11);
    const rotations = turns * 1.5 * (1 - slip) * scatter;
    const scrapes = size > 4 ? Math.max(1, Math.round((size - 4) * turns * 0.35 * scatter)) : 0;
    return {
      reading: `In ${turns} ${turns === 1 ? 'turn' : 'turns'} the fin went round ${round(rotations)} times and ${scrapes} ${scrapes === 1 ? 'scrape was' : 'scrapes were'} heard.`,
    };
  },
};
