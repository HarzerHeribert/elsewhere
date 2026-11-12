import { HOUR, act, control, hash, numberOf, round, type Mechanism } from './common.js';

const SEEDS = 24;
const SPROUTED_BY_HOURS = 3;
/**
 * Garden peas (Pisum sativum). Hidden: each line holds a pair of alleles for each of two
 * traits. Capitals dominate: T tall stem over t dwarf, R round seed over r wrinkled.
 */
const LINES: Array<{ stem: string; seed: string }> = [
  { stem: 'TT', seed: 'RR' },
  { stem: 'tt', seed: 'rr' },
  { stem: 'TT', seed: 'rr' },
  { stem: 'tt', seed: 'RR' },
  { stem: 'Tt', seed: 'Rr' },
  { stem: 'Tt', seed: 'rr' },
];

const pick = (pair: string, seed: string) => pair[hash(seed) < 0.5 ? 0 : 1];

/** The plants of a sowing: how many are tall and how many bear round seed. */
function offspring(salt: string, mother: number, father: number) {
  let tall = 0;
  let roundCount = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = `${salt}:${mother}:${father}:${i}`;
    const stem =
      pick(LINES[mother - 1].stem, `${seed}:h:m`) + pick(LINES[father - 1].stem, `${seed}:h:f`);
    const shape =
      pick(LINES[mother - 1].seed, `${seed}:l:m`) + pick(LINES[father - 1].seed, `${seed}:l:f`);
    if (/T/.test(stem)) tall++;
    if (/R/.test(shape)) roundCount++;
  }
  return { tall, dwarf: SEEDS - tall, round: roundCount, wrinkled: SEEDS - roundCount };
}

/** Breeding: six lines of garden pea, a sowing tray, and what comes up. */
export const seedDrawers: Mechanism = {
  controls: [
    control('mother', 'take the seed of one line as the mother', 1, 6, 'line number'),
    control('father', 'take the seed of one line as the father', 1, 6, 'line number'),
    act('sow', 'cross the two lines and sow the seeds in the tray'),
    act('count', 'count the tray'),
  ],
  run: ({ control: id, value, state, object, now }) => {
    const mother = numberOf(state, 'mother', 1);
    const father = numberOf(state, 'father', 1);
    if (id === 'mother')
      return {
        reading: `Line ${value} is taken as the mother.`,
        state: { ...state, mother: value as number },
      };
    if (id === 'father')
      return {
        reading: `Line ${value} is taken as the father.`,
        state: { ...state, father: value as number },
      };
    if (id === 'sow') {
      return {
        reading: `${SEEDS} seeds of line ${mother} crossed with line ${father} are sown in the tray; any earlier sowing is cleared away.`,
        state: {
          ...state,
          sownAt: now,
          sownMother: mother,
          sownFather: father,
          sowing: numberOf(state, 'uses', 0),
        },
      };
    }
    const sownAt = numberOf(state, 'sownAt', Number.NaN);
    if (Number.isNaN(sownAt)) return { reading: 'The tray is empty.' };
    const m = numberOf(state, 'sownMother', 1);
    const f = numberOf(state, 'sownFather', 1);
    const hours = Math.max(0, now - sownAt) / HOUR;
    const head = `The tray of line ${m} crossed with line ${f}, sown ${round(hours)} h ago`;
    if (hours < SPROUTED_BY_HOURS) {
      let sprouted = 0;
      for (let i = 0; i < SEEDS; i++)
        if (0.4 + 2.4 * hash(`${object.id}:sprout:${numberOf(state, 'sowing', 0)}:${i}`) <= hours)
          sprouted++;
      return {
        reading: `${head}: ${sprouted} of ${SEEDS} seeds have sprouted so far.`,
      };
    }
    const result = offspring(`${object.id}:cross:${numberOf(state, 'sowing', 0)}`, m, f);
    return {
      reading: `${head}: ${SEEDS} plants, ${result.tall} tall and ${result.dwarf} dwarf, ${result.round} with round seed and ${result.wrinkled} with wrinkled seed.`,
    };
  },
};
