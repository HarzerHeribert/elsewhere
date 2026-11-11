import { describe, expect, it } from 'vitest';
import { reproducesPrivateText } from './public-text';

const secret =
  'The heron stands motionless in the shallows because fish mistake stillness for safety.';
describe('reproducesPrivateText', () => {
  it('detects an exact quote inside other words', () => {
    expect(reproducesPrivateText(`He said: ${secret} Remarkable.`, [secret])).toBe(true);
  });
  it('ignores case and whitespace differences', () => {
    const changed = secret.toUpperCase().replace(/ /g, '  \n ');
    expect(reproducesPrivateText(changed, [secret])).toBe(true);
  });
  it('is false for a 39-character overlap and true for 40', () => {
    const source = 'abcdefghij'.repeat(6);
    const overlap = (n: number) => `zzz ${source.slice(5, 5 + n)} zzz`;
    expect(reproducesPrivateText(overlap(39), [source])).toBe(false);
    expect(reproducesPrivateText(overlap(40), [source])).toBe(true);
    expect(reproducesPrivateText(overlap(10), [source], 10)).toBe(true);
  });
  it('matches short private texts only whole', () => {
    expect(reproducesPrivateText('I like  the Quiet harbour.', ['the quiet harbour'])).toBe(true);
    expect(reproducesPrivateText('the quiet', ['the quiet harbour'])).toBe(false);
    expect(reproducesPrivateText('short short', ['short'])).toBe(false);
  });
  it('handles empty inputs', () => {
    expect(reproducesPrivateText('', [secret])).toBe(false);
    expect(reproducesPrivateText(secret, [])).toBe(false);
    expect(reproducesPrivateText(secret, ['', '   '])).toBe(false);
    expect(reproducesPrivateText('', [''])).toBe(false);
  });
});
