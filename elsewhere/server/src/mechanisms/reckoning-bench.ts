import { written, type Mechanism } from './common.js';

/** The bench keeps nothing and adds no scatter: every reading is exact for what was written. */

class Unreadable extends Error {
  constructor(readonly at: number) {
    super('unreadable');
  }
}
class NoAnswer extends Error {}

const NUMBER = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Significant digits, trailing zeros dropped, plain decimal where that is sensible. */
export function sig(value: number, digits: number): string {
  if (value === 0 || Object.is(value, -0)) return '0';
  const rounded = Number(value.toPrecision(digits));
  const size = Math.abs(rounded);
  if (size >= 1e-6 && size < 1e15) return String(rounded);
  return rounded.toExponential().replace('e+', 'e');
}

const checked = (value: number) => {
  if (!Number.isFinite(value)) throw new NoAnswer();
  return value;
};
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (rad: number) => (rad * 180) / Math.PI;
/** Exact at the quarter turns, so that sin(180) is 0 and cos(90) is 0. */
const turn = (angle: number, offset: number) => {
  const r = (((angle + offset) % 360) + 360) % 360;
  if (r === 0) return 1;
  if (r === 90 || r === 270) return 0;
  if (r === 180) return -1;
  return Math.cos(radians(r));
};
const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  sin: (x) => turn(x, -90),
  cos: (x) => turn(x, 0),
  tan: (x) => {
    const c = turn(x, 0);
    return c === 0 ? NaN : turn(x, -90) / c;
  },
  asin: (x) => degrees(Math.asin(x)),
  acos: (x) => degrees(Math.acos(x)),
  atan: (x) => degrees(Math.atan(x)),
  round: Math.round,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token = { kind: 'num' | 'name' | 'op'; text: string; at: number };

function tokens(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (/^\s/.test(rest)) {
      i++;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      out.push({ kind: 'num', text: number[0], at: i });
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z]+/.exec(rest);
    if (name) {
      out.push({ kind: 'name', text: name[0].toLowerCase(), at: i });
      i += name[0].length;
      continue;
    }
    if ('+-*/^()'.includes(rest[0])) {
      out.push({ kind: 'op', text: rest[0], at: i });
      i++;
      continue;
    }
    throw new Unreadable(i + 1);
  }
  return out;
}

/** A small recursive-descent evaluator; throws Unreadable with a 1-based position. */
export function evaluate(source: string): number {
  const list = tokens(source);
  let index = 0;
  const here = () => list[index];
  const fail = (): never => {
    throw new Unreadable((here()?.at ?? source.length) + 1);
  };
  const isOp = (text: string) => here()?.kind === 'op' && here().text === text;
  const expect = (text: string) => {
    if (!isOp(text)) fail();
    index++;
  };
  const expression = (): number => {
    let value = term();
    while (isOp('+') || isOp('-')) {
      const plus = here().text === '+';
      index++;
      const right = term();
      value = checked(plus ? value + right : value - right);
    }
    return value;
  };
  const term = (): number => {
    let value = unary();
    while (isOp('*') || isOp('/')) {
      const times = here().text === '*';
      index++;
      const right = unary();
      value = checked(times ? value * right : value / right);
    }
    return value;
  };
  const unary = (): number => {
    if (isOp('-')) {
      index++;
      return -unary();
    }
    if (isOp('+')) {
      index++;
      return unary();
    }
    return power();
  };
  // Right-associative, and binding tighter than a minus in front: -2^2 is -4, 2^-1 is 0.5.
  const power = (): number => {
    const base = atom();
    if (!isOp('^')) return base;
    index++;
    return checked(base ** unary());
  };
  const atom = (): number => {
    const token = here();
    if (!token) return fail();
    if (token.kind === 'num') {
      index++;
      return checked(Number(token.text));
    }
    if (token.kind === 'op') {
      if (token.text !== '(') return fail();
      index++;
      const inner = expression();
      expect(')');
      return inner;
    }
    if (token.text in FUNCTIONS) {
      index++;
      expect('(');
      const argument = expression();
      expect(')');
      return checked(FUNCTIONS[token.text](argument));
    }
    if (token.text in CONSTANTS) {
      index++;
      return CONSTANTS[token.text];
    }
    return fail();
  };
  const value = expression();
  if (index < list.length) fail();
  return checked(value);
}

const reckon = (text: string) => {
  try {
    return { reading: `The bench gives ${sig(evaluate(text), 6)}.` };
  } catch (error) {
    if (error instanceof Unreadable)
      return { problem: `The sum cannot be read at character ${error.at}.` };
    if (error instanceof NoAnswer) return { problem: 'That sum has no answer.' };
    throw error;
  }
};

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

const tally = (text: string) => {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const values = parts.map((part) => (PLAIN_NUMBER.test(part) ? Number(part) : NaN));
  if (parts.length < 2 || parts.length > 60 || values.some((value) => !Number.isFinite(value)))
    return {
      problem:
        'The tally needs 2 to 60 numbers separated by spaces, commas or semicolons, each readable as a number.',
    };
  const centre = mean(values);
  const spread =
    values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1);
  const deviation = Math.sqrt(spread);
  const total = values.reduce((a, b) => a + b, 0);
  if (![total, centre, deviation].every(Number.isFinite))
    return { problem: 'That tally has no answer.' };
  return {
    reading:
      `The bench counts ${values.length} numbers with sum ${sig(total, 4)} and mean ${sig(centre, 4)}, ` +
      `smallest ${sig(Math.min(...values), 4)} and largest ${sig(Math.max(...values), 4)}. ` +
      `The sample standard deviation is ${sig(deviation, 4)} and the standard error of the mean is ${sig(deviation / Math.sqrt(values.length), 4)}.`,
  };
};

/** Least squares of y on x: intercept, slope and r squared; undefined when x does not vary. */
export function regress(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  });
  if (sxx === 0) return undefined;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

const signed = (value: number) => (value < 0 ? `- ${sig(-value, 4)}` : `+ ${sig(value, 4)}`);

const fit = (text: string) => {
  const rows = text
    .split(/;|\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(/[\s,]+/).filter(Boolean));
  const numbers = rows.map((row) =>
    row.length === 2 && row.every((part) => PLAIN_NUMBER.test(part)) ? row.map(Number) : undefined,
  );
  if (
    rows.length < 3 ||
    rows.length > 40 ||
    numbers.some((pair) => !pair || !pair.every(Number.isFinite))
  )
    return {
      problem:
        'The fit needs 3 to 40 pairs of numbers, pairs separated by semicolons or line breaks and the two numbers of a pair by a space or comma.',
    };
  const xs = numbers.map((pair) => pair![0]);
  const ys = numbers.map((pair) => pair![1]);
  const line = regress(xs, ys);
  if (!line || ![line.slope, line.intercept, line.r2].every(Number.isFinite))
    return { problem: 'The x values give no line to fit.' };
  let reading = `The least-squares straight line is y = ${sig(line.intercept, 4)} ${signed(line.slope)} x with r squared ${sig(line.r2, 4)}.`;
  if (xs.every((x) => x > 0) && ys.every((y) => y > 0)) {
    const curve = regress(xs.map(Math.log), ys.map(Math.log));
    if (curve) {
      const k = Math.exp(curve.intercept);
      if (Number.isFinite(k))
        reading += ` The power curve is y = ${sig(k, 4)} x^${sig(curve.slope, 4)} with r squared ${sig(curve.r2, 4)}.`;
    }
  }
  return { reading };
};

/** Calculation: a slate bench that works out sums, tallies and straight-line and power-curve fits. */
export const reckoningBench: Mechanism = {
  controls: [
    written('reckon', 'work out a written sum', 200, 'an arithmetic expression; angles in degrees'),
    written(
      'tally',
      'tally a list of numbers into mean and spread',
      400,
      'two to sixty numbers separated by spaces, commas or semicolons',
    ),
    written(
      'fit',
      'fit pairs of numbers with a straight line and a power curve by least squares',
      400,
      'three to forty pairs, separated by semicolons or line breaks, the two numbers of a pair by a space or comma',
    ),
  ],
  run: ({ control: id, text }) => {
    const input = text ?? '';
    return id === 'reckon' ? reckon(input) : id === 'tally' ? tally(input) : fit(input);
  },
};
