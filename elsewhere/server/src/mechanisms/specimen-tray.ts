import { act, control, numberOf, type Mechanism } from './common.js';

interface Structure {
  name: string;
  /** Per millimetre of the field. */
  density: number;
  /** Only told apart at or above this power. */
  resolvesAt: number;
}
const SPECIMENS: Array<{ name: string; structures: Structure[] }> = [
  {
    name: 'a feather',
    structures: [
      { name: 'barbs', density: 9, resolvesAt: 3 },
      { name: 'barbules', density: 60, resolvesAt: 15 },
      { name: 'hooklets', density: 150, resolvesAt: 32 },
    ],
  },
  {
    name: 'a leaf',
    structures: [
      { name: 'veins', density: 3, resolvesAt: 2 },
      { name: 'cells', density: 30, resolvesAt: 10 },
      { name: 'pores', density: 45, resolvesAt: 25 },
    ],
  },
  {
    name: 'sand',
    structures: [
      { name: 'grains', density: 4, resolvesAt: 2 },
      { name: 'facets', density: 20, resolvesAt: 12 },
      { name: 'flecks', density: 60, resolvesAt: 28 },
    ],
  },
  {
    name: 'a moth wing',
    structures: [
      { name: 'rows of scales', density: 10, resolvesAt: 3 },
      { name: 'scales', density: 25, resolvesAt: 6 },
      { name: 'ridges', density: 120, resolvesAt: 30 },
    ],
  },
  {
    name: 'a drop of pond water',
    structures: [
      { name: 'green threads', density: 1.5, resolvesAt: 4 },
      { name: 'round cells', density: 12, resolvesAt: 12 },
      { name: 'swimmers', density: 6, resolvesAt: 20 },
    ],
  },
  {
    name: 'a scrap of paper',
    structures: [
      { name: 'fibre bundles', density: 5, resolvesAt: 2 },
      { name: 'fibres', density: 14, resolvesAt: 5 },
      { name: 'fillers', density: 80, resolvesAt: 25 },
    ],
  },
];
const FIELD_MM_AT_ONE = 18;

/** Microscopy: six specimens under a lens whose field narrows as its power rises. */
export const specimenTray: Mechanism = {
  controls: [
    control('pick', 'slide one specimen under the lens', 1, 6, 'specimen number'),
    control('power', 'change the lens', 2, 40, 'times magnification'),
    act('look', 'look through the lens'),
  ],
  run: ({ control: id, value, state, scatter }) => {
    if (id === 'pick')
      return {
        reading: `Specimen ${value} is under the lens.`,
        state: { ...state, pick: value as number },
      };
    if (id === 'power')
      return {
        reading: `The lens is now set to ${value} times.`,
        state: { ...state, power: value as number },
      };
    const picked = numberOf(state, 'pick', 1);
    const power = numberOf(state, 'power', 2);
    const specimen = SPECIMENS[picked - 1];
    const field = FIELD_MM_AT_ONE / power;
    const seen = specimen.structures
      .filter((structure) => power >= structure.resolvesAt)
      .map((structure) => {
        const count = Math.max(1, Math.round(structure.density * field * scatter));
        return `${count} ${structure.name}`;
      });
    const head = `Specimen ${picked}, ${specimen.name}, at ${power} times, in a field ${(Math.round(field * 100) / 100).toString()} mm wide`;
    return {
      reading: seen.length
        ? `${head}: ${seen.join(', ')} can be counted.`
        : `${head}: nothing more than a smooth, featureless surface can be told apart.`,
    };
  },
};
