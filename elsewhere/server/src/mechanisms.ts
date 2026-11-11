import type { WorldControl, WorldObject } from '@elsewhere/character-interfaces';

/**
 * Objects that answer back. Everything here is pure and deterministic: a reading depends on
 * the control worked, the hidden state of the object, the world conditions at the world time
 * and a small scatter seeded by the object's use counter. None of it is ever written into
 * text a resident or visitor can read; only the numbers come out.
 */
export interface Conditions {
  sunElevationDeg: number;
  sunBearingDeg: number;
  windSpeed: number;
  windBearingDeg: number;
  airTempC: number;
}
export type MechanismState = Record<string, number>;
export type OperateResult =
  | { ok: true; reading: string; state: MechanismState }
  | { ok: false; problem: string };

const MINUTE = 60_000;
const TAU = Math.PI * 2;
const wave = (now: number, periodMinutes: number, phase: number) =>
  Math.sin((TAU * now) / (periodMinutes * MINUTE) + phase);
const mod = (value: number, base: number) => ((value % base) + base) % base;

/** Conditions at a world time. Never exposed directly. */
export function worldConditions(now: number): Conditions {
  const hour = mod(now / 3_600_000, 24);
  const sunElevationDeg = 60 * Math.sin((TAU * (hour - 6)) / 24) - 5;
  const sunBearingDeg = mod(90 + (hour - 6) * 15, 360);
  const windSpeed = Math.max(
    0,
    3.4 +
      1.6 * wave(now, 37, 0.7) +
      1.3 * wave(now, 83, 2.1) +
      1.1 * wave(now, 251, 4) +
      1.5 * wave(now, 613, 1.3),
  );
  const windBearingDeg = mod(
    225 + 55 * wave(now, 191, 0.4) + 40 * wave(now, 457, 2.2) + 15 * wave(now, 53, 5),
    360,
  );
  const airTempC =
    12 +
    4 * wave(now, 720, 3.5) +
    3 * wave(now, 320, 1.1) +
    1.5 * wave(now, 107, 0.2) +
    0.8 * wave(now, 41, 2.9);
  return { sunElevationDeg, sunBearingDeg, windSpeed, windBearingDeg, airTempC };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** About +-2%, seeded by the object, the control and how often the object was used. */
const scatterOf = (id: string, control: string, uses: number) =>
  1 + (hash(`${id}:${control}:${uses}`) - 0.5) * 0.04;

const round = (value: number, digits = 1) => value.toFixed(digits);
const bearing = (value: number) => mod(Math.round(value), 360);

interface Mechanism {
  controls: WorldControl[];
  run: (input: {
    object: WorldObject;
    control: string;
    value: number | undefined;
    state: MechanismState;
    conditions: Conditions;
    scatter: number;
  }) => { reading: string; state?: MechanismState };
}

const CHIME_LENGTHS = [1, 0.86, 0.76, 0.68, 0.62];
const CHIME_THRESHOLDS = [4.5, 3.6, 2.8, 2.0, 1.2];
const STONE_HEIGHTS = [1.7, 1.2, 2.1, 1.5, 1.9, 1.1, 1.4];
const INITIAL_FIN = 7;

const mechanisms: Record<string, Mechanism> = {
  sundial: {
    controls: [{ id: 'read', description: 'read the shadow of the pointer' }],
    run: ({ conditions, scatter }) => {
      if (conditions.sunElevationDeg < 2) return { reading: 'No shadow falls on the dial.' };
      const length = (18 / Math.tan((conditions.sunElevationDeg * Math.PI) / 180)) * scatter;
      const falls = bearing(conditions.sunBearingDeg + 180 + (scatter - 1) * 100);
      return {
        reading: `The shadow is ${round(length)} cm long and falls toward ${falls} degrees.`,
      };
    },
  },
  windchime: {
    controls: [
      {
        id: 'strike',
        description: 'strike one tube',
        value: { min: 1, max: 5, step: 1, meaning: 'tube number' },
      },
      { id: 'listen', description: 'listen to the chime for ten seconds' },
    ],
    run: ({ control, value, conditions, scatter, object, state }) => {
      if (control === 'strike') {
        const length = CHIME_LENGTHS[(value as number) - 1];
        const pitch = (400 / length ** 2) * scatter;
        const ring = (8 * length ** 1.5 * scatter) / (1 + 0.15 * conditions.windSpeed);
        return { reading: `The tube rings at ${round(pitch, 0)} Hz for ${round(ring)} s.` };
      }
      const uses = state.uses ?? 0;
      const rang: string[] = [];
      CHIME_THRESHOLDS.forEach((threshold, index) => {
        if (conditions.windSpeed <= threshold) return;
        const times = Math.max(
          1,
          Math.round(
            (conditions.windSpeed - threshold) * 1.5 * scatterOf(object.id, `tube${index}`, uses),
          ),
        );
        rang.push(`tube ${index + 1} ${times} ${times === 1 ? 'time' : 'times'}`);
      });
      return {
        reading: rang.length
          ? `In ten seconds the wind rang ${rang.join(', ')}.`
          : 'In ten seconds none of the tubes rang.',
      };
    },
  },
  'weather-marker': {
    controls: [{ id: 'read', description: 'watch the flag for ten seconds' }],
    run: ({ conditions, scatter }) => {
      if (conditions.windSpeed < 0.6) return { reading: 'The flag hangs limp.' };
      const flicks = Math.round(1.8 * conditions.windSpeed * scatter);
      const points = bearing(conditions.windBearingDeg + (scatter - 1) * 100);
      return {
        reading: `The flag points toward ${points} degrees and flicks ${flicks} times in ten seconds.`,
      };
    },
  },
  artifact: {
    controls: [
      {
        id: 'bend',
        description: 'bend the copper fin',
        value: { min: -10, max: 10, step: 0.5, meaning: 'fin angle in degrees' },
      },
      {
        id: 'turn',
        description: 'turn the crank',
        value: { min: 1, max: 20, step: 1, meaning: 'crank turns' },
      },
    ],
    run: ({ control, value, state, scatter }) => {
      const angle = state.fin ?? INITIAL_FIN;
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
  },
  pond: {
    controls: [
      {
        id: 'drop',
        description: 'drop a pebble in the water',
        value: { min: 1, max: 5, step: 1, meaning: 'pebble size' },
      },
    ],
    run: ({ value, conditions, scatter }) => {
      const seconds = 6.4 * scatter;
      const rings = Math.max(
        1,
        Math.round(
          (1.5 + (value as number) * 1.1) *
            (1 - Math.min(conditions.windSpeed, 10) * 0.04) *
            scatter,
        ),
      );
      return {
        reading: `The ring reaches the bank after ${round(seconds)} s and ${rings} ${rings === 1 ? 'ring' : 'rings'} could be counted.`,
      };
    },
  },
  telescope: {
    controls: [
      {
        id: 'focus',
        description: 'turn the focus ring',
        value: { min: 0, max: 100, step: 1, meaning: 'ring position' },
      },
    ],
    run: ({ value, conditions, scatter }) => {
      const best = 58 + 0.9 * (conditions.airTempC - 12);
      const sharpness = Math.exp(-((((value as number) * scatter - best) / 9) ** 2));
      const sunUp = conditions.sunElevationDeg > 0;
      const craters = Math.round(11 * sharpness * (sunUp ? 0.5 : 1));
      const edge = sharpness > 0.75 ? 'crisp' : sharpness > 0.35 ? 'soft' : 'blurred';
      return {
        reading: `The moon's edge is ${edge}; ${craters} ${craters === 1 ? 'crater' : 'craters'} can be told apart.`,
      };
    },
  },
  stones: {
    controls: [
      {
        id: 'tap',
        description: 'tap one stone',
        value: { min: 1, max: 7, step: 1, meaning: 'stone number' },
      },
    ],
    run: ({ value, conditions, scatter }) => {
      const height = STONE_HEIGHTS[(value as number) - 1];
      const pitch = (190 / height) * scatter;
      const carries = ((0.9 + 0.6 * height) * scatter) / (1 + 0.05 * conditions.windSpeed);
      return {
        reading: `The knock sounds at ${round(pitch, 0)} Hz and carries for ${round(carries)} s.`,
      };
    },
  },
};

/** The controls an object of this kind offers, or undefined when it cannot be worked. */
export function mechanismFor(kind: string): WorldControl[] | undefined {
  const found = mechanisms[kind];
  return found ? found.controls.map((control) => structuredClone(control)) : undefined;
}

export function operate(
  object: WorldObject,
  control: string,
  value: number | undefined,
  state: MechanismState | undefined,
  now: number,
): OperateResult {
  const mechanism = mechanisms[object.kind];
  if (!mechanism) return { ok: false, problem: 'That object has no controls.' };
  const chosen = mechanism.controls.find((item) => item.id === control);
  if (!chosen) {
    return {
      ok: false,
      problem: `That object has no control called ${control}. Its controls are: ${mechanism.controls.map((item) => item.id).join(', ')}.`,
    };
  }
  const range = chosen.value;
  let used: number | undefined;
  if (range) {
    const whole = range.step === 1;
    if (
      value === undefined ||
      !Number.isFinite(value) ||
      value < range.min ||
      value > range.max ||
      (whole && !Number.isInteger(value))
    ) {
      return {
        ok: false,
        problem: `${control} needs a ${whole ? 'whole ' : ''}number from ${range.min} to ${range.max} (${range.meaning}).`,
      };
    }
    // A control cannot be set finer than its step: the nearest setting is what takes effect.
    used = range.step ? Math.round(value / range.step) * range.step : value;
  }
  const current = state ?? {};
  const uses = current.uses ?? 0;
  const result = mechanism.run({
    object,
    control,
    value: used,
    state: current,
    conditions: worldConditions(now),
    scatter: scatterOf(object.id, control, uses),
  });
  return {
    ok: true,
    reading: result.reading,
    state: { ...(result.state ?? current), uses: uses + 1 },
  };
}
