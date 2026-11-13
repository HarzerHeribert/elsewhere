import { describe, expect, it } from 'vitest';
import { executeWorldCommand, createInitialWorld, upgradeWorldLayout } from './world.js';
import { mechanismFor, operate } from './mechanisms/index.js';

const world = createInitialWorld(0);
const bench = world.objects.find((item) => item.id === 'reckoning-bench')!;
const at = Date.UTC(2026, 10, 9, 12);
const run = (control: string, text?: string) =>
  operate(bench, control, undefined, undefined, at, undefined, text);
const reading = (control: string, text: string) => {
  const result = run(control, text);
  if (!result.ok) throw new Error(result.problem);
  return result.reading;
};
const problem = (control: string, text?: string) => {
  const result = run(control, text);
  if (result.ok) throw new Error(`expected a problem, got ${result.reading}`);
  return result.problem;
};
const gives = (text: string) => reading('reckon', text);

describe('reckon', () => {
  it('follows the usual precedence and right-associative powers', () => {
    expect(gives('1 + 2 * 3')).toBe('The bench gives 7.');
    expect(gives('(1 + 2) * 3')).toBe('The bench gives 9.');
    expect(gives('2 ^ 3 ^ 2')).toBe('The bench gives 512.');
    expect(gives('-2 ^ 2')).toBe('The bench gives -4.');
    expect(gives('2 ^ -1')).toBe('The bench gives 0.5.');
    expect(gives('10 - 4 - 3')).toBe('The bench gives 3.');
    expect(gives('--3')).toBe('The bench gives 3.');
    expect(gives('4 / pi')).toBe('The bench gives 1.27324.');
    expect(gives('sqrt(16) + abs(-2) + round(2.6)')).toBe('The bench gives 9.');
  });
  it('reads scientific notation, constants and logarithms', () => {
    expect(gives('1.5e3 + 2E-1')).toBe('The bench gives 1500.2.');
    expect(gives('e')).toBe('The bench gives 2.71828.');
    expect(gives('ln(e)')).toBe('The bench gives 1.');
    expect(gives('log(1000)')).toBe('The bench gives 3.');
    expect(gives('exp(0)')).toBe('The bench gives 1.');
  });
  it('takes angles in degrees', () => {
    expect(gives('sin(30)')).toBe('The bench gives 0.5.');
    expect(gives('cos(180)')).toBe('The bench gives -1.');
    expect(gives('sin(180)')).toBe('The bench gives 0.');
    expect(gives('tan(45)')).toBe('The bench gives 1.');
    expect(gives('asin(1)')).toBe('The bench gives 90.');
    expect(gives('atan(1)')).toBe('The bench gives 45.');
  });
  it('names the position of what cannot be read, and never repeats the input', () => {
    expect(problem('reckon', '1 + * 2')).toBe('The sum cannot be read at character 5.');
    expect(problem('reckon', '1 + $')).toBe('The sum cannot be read at character 5.');
    expect(problem('reckon', '2 +')).toBe('The sum cannot be read at character 4.');
    expect(problem('reckon', '(1 + 2')).toBe('The sum cannot be read at character 7.');
    expect(problem('reckon', 'secret(1)')).toBe('The sum cannot be read at character 1.');
    expect(problem('reckon', '1 2')).toBe('The sum cannot be read at character 3.');
    expect(problem('reckon', 'zzz')).not.toMatch(/zzz/);
  });
  it('says when a sum has no answer', () => {
    for (const sum of ['1/0', 'sqrt(-1)', 'ln(0)', 'tan(90)', 'asin(2)', '10^1000'])
      expect(problem('reckon', sum)).toBe('That sum has no answer.');
  });
});

describe('tally', () => {
  it('gives the count, spread and error of a known list', () => {
    expect(reading('tally', '2, 4; 4 4 5 5 7 9')).toBe(
      'The bench counts 8 numbers with sum 40 and mean 5, smallest 2 and largest 9. The sample standard deviation is 2.138 and the standard error of the mean is 0.7559.',
    );
  });
  it('refuses lists that are too short or unreadable', () => {
    expect(problem('tally', '3')).toMatch(/2 to 60 numbers/);
    expect(problem('tally', '1 2 x')).toMatch(/2 to 60 numbers/);
    expect(problem('tally', Array(61).fill('1').join(' '))).toMatch(/2 to 60 numbers/);
  });
});

describe('fit', () => {
  it('recovers a known line exactly', () => {
    expect(reading('fit', '0 1; 1,3\n2 5; 3 7')).toBe(
      'The least-squares straight line is y = 1 + 2 x with r squared 1.',
    );
    expect(reading('fit', '1 5; 2 3; 3 1')).toContain('y = 7 - 2 x with r squared 1.');
  });
  it('recovers the exponent of a power curve', () => {
    const pairs = [1, 4, 9, 16, 25, 100].map((x) => `${x} ${2.007 * Math.sqrt(x / 100)}`);
    const text = reading('fit', pairs.join('; '));
    expect(text).toContain('The power curve is y = 0.2007 x^0.5 with r squared 1.');
  });
  it('offers the power curve only for positive numbers', () => {
    expect(reading('fit', '-1 1; 0 2; 1 4')).not.toMatch(/power/);
    expect(reading('fit', '1 0; 2 1; 3 2')).not.toMatch(/power/);
  });
  it('refuses too few pairs, odd rows and a single x', () => {
    expect(problem('fit', '1 2; 3 4')).toMatch(/3 to 40 pairs/);
    expect(problem('fit', '1 2 3; 3 4; 5 6')).toMatch(/3 to 40 pairs/);
    expect(problem('fit', '1 2; 1 3; 1 4')).toMatch(/no line/);
  });
});

describe('written input at the door', () => {
  it('lists the bench controls as text controls', () => {
    const controls = mechanismFor('reckoning-bench')!;
    expect(controls.map((item) => item.id)).toEqual(['reckon', 'tally', 'fit']);
    expect(controls.map((item) => item.text?.max)).toEqual([200, 400, 400]);
    expect(controls.every((item) => !item.value)).toBe(true);
  });
  it('refuses missing, empty and over-long text', () => {
    expect(problem('reckon')).toMatch(/^reckon needs written input \(.*\)\.$/);
    expect(problem('reckon', '   ')).toMatch(/^reckon needs written input/);
    expect(problem('reckon', '1+'.repeat(101))).toMatch(/of at most 200 characters/);
    expect(problem('tally', '1 '.repeat(201))).toMatch(/of at most 400 characters/);
  });
  it('ignores text given to a control that takes none', () => {
    const music = world.objects.find((item) => item.kind === 'music-box')!;
    const result = operate(music, 'play', undefined, undefined, at, undefined, 'hello');
    expect(result.ok).toBe(true);
  });
  it('keeps no hidden state beyond the use count', () => {
    const result = run('reckon', '1+1');
    expect(result.ok && Object.keys(result.state)).toEqual(['uses']);
  });
});

describe('the bench in the world', () => {
  it('stands in the workshop clear of every other object', () => {
    const place = world.places.find((item) => item.id === 'workshop')!.bounds;
    expect(bench.position.x).toBeGreaterThan(place.minX);
    expect(bench.position.x).toBeLessThan(place.maxX);
    expect(bench.position.z).toBeGreaterThan(place.minZ);
    expect(bench.position.z).toBeLessThan(place.maxZ);
    for (const other of world.objects.filter((item) => item.id !== bench.id)) {
      const gap = Math.hypot(
        other.position.x - bench.position.x,
        other.position.z - bench.position.z,
      );
      expect(gap, other.id).toBeGreaterThan(other.radius + bench.radius);
    }
    for (const wall of world.obstacles) {
      const near =
        bench.position.x + bench.radius > wall.minX &&
        bench.position.x - bench.radius < wall.maxX &&
        bench.position.z + bench.radius > wall.minZ &&
        bench.position.z - bench.radius < wall.maxZ;
      expect(near, wall.id).toBe(false);
    }
  });
  it('works through a use command with text, end to end', () => {
    const start = createInitialWorld(at);
    start.residents[0].position = { x: bench.position.x, z: bench.position.z + 1 };
    const result = executeWorldCommand(
      start,
      'hubert',
      { type: 'use', targetId: 'reckoning-bench', control: 'reckon', text: '2 ^ 10' },
      at,
    );
    expect(result.outcome.status).toBe('completed');
    expect(result.outcome.summary).toContain('The bench gives 1024.');
    expect(result.outcome.summary).not.toContain('2 ^ 10');
    const refused = executeWorldCommand(
      start,
      'hubert',
      { type: 'use', targetId: 'reckoning-bench', control: 'reckon' },
      at,
    );
    expect(refused.outcome.summary).toMatch(/needs written input/);
  });
  it('adds the bench to a saved world that lacks it', () => {
    const old = createInitialWorld(at);
    old.objects = old.objects.filter((item) => item.id !== 'reckoning-bench');
    const upgraded = upgradeWorldLayout(old);
    expect(upgraded.objects.find((item) => item.id === 'reckoning-bench')).toEqual(bench);
    expect(upgradeWorldLayout(upgraded)).toBe(upgraded);
  });
});
