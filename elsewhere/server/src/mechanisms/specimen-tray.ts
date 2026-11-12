import { act, control, numberOf, type Mechanism } from './common.js';

interface Structure {
  name: string;
  /** Per millimetre of the field's width, or per square millimetre when `area` is set. */
  density: number;
  area?: boolean;
  /** Only told apart at or above this power. */
  resolvesAt: number;
  /** How much the count varies from one look to the next (1 is the usual small scatter). */
  spread?: number;
}
export const SPECIMENS: Array<{ name: string; structures: Structure[] }> = [
  {
    name: 'a feather',
    structures: [
      { name: 'barbs', density: 2, resolvesAt: 2 },
      { name: 'barbules', density: 30, resolvesAt: 15 },
    ],
  },
  {
    name: 'a leaf',
    structures: [
      { name: 'veins', density: 1.5, resolvesAt: 2 },
      { name: 'stomata', density: 180, area: true, resolvesAt: 20 },
    ],
  },
  {
    name: 'sand',
    structures: [{ name: 'grains', density: 7, area: true, resolvesAt: 5 }],
  },
  {
    name: 'a moth wing',
    structures: [
      { name: 'rows of scales', density: 14, resolvesAt: 4 },
      { name: 'scales', density: 140, area: true, resolvesAt: 8 },
      { name: 'ridges on a scale', density: 500, resolvesAt: 35 },
    ],
  },
  {
    name: 'a drop of pond water',
    structures: [
      { name: 'slipper-shaped swimmers', density: 4, area: true, resolvesAt: 10, spread: 8 },
      { name: 'smaller green cells', density: 60, area: true, resolvesAt: 25, spread: 4 },
    ],
  },
  {
    name: 'a scrap of paper',
    structures: [{ name: 'fibres', density: 20, resolvesAt: 10 }],
  },
];
/** Width in mm of the field at 1 times; the field is a round view that many mm across. */
const FIELD_MM_AT_ONE = 18;

/** Microscopy: six specimens under a lens whose round field narrows as its power rises. */
export const specimenTray: Mechanism = {
  controls: [
    control('pick', 'slide one specimen under the lens', 1, 6, 'specimen number'),
    control('power', 'change the lens', 2, 60, 'times magnification'),
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
        const extent = structure.area ? (Math.PI / 4) * field ** 2 : field;
        const varied = 1 + (scatter - 1) * (structure.spread ?? 1);
        const count = Math.max(1, Math.round(structure.density * extent * varied));
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
