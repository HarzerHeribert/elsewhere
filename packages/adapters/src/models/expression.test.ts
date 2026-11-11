import { describe, expect, it } from 'vitest';
import {
  PublicExpressionInputSchema,
  expressionMessages,
  validatePublicExpression,
  validatePublicWork,
} from './expression';

const work = {
  form: 'work' as const,
  path: 'notes/a.md',
  title: 'A',
  about: 'About A.',
  siteUrl: 'https://studio.invalid/',
  material: { notes: ['n'], readings: ['r'], openQuestions: [] },
  shelf: [{ path: 'index.html', title: 'Home' }],
};

describe('authoring one file', () => {
  it('accepts the work form with a long existing file and rejects unknown fields', () => {
    expect(
      PublicExpressionInputSchema.safeParse({ ...work, existing: 'x'.repeat(16000) }).success,
    ).toBe(true);
    expect(
      PublicExpressionInputSchema.safeParse({ ...work, existing: 'x'.repeat(16001) }).success,
    ).toBe(false);
    expect(PublicExpressionInputSchema.safeParse({ ...work, path: 'Bad.md' }).success).toBe(false);
    expect(PublicExpressionInputSchema.safeParse({ ...work, extra: 1 }).success).toBe(false);
  });

  it('asks for the whole file in its own system prompt', () => {
    const [system, user] = expressionMessages('I am a resident.', work);
    expect(system.content).toContain('You are writing one file for your own public site');
    expect(system.content).toContain('Never include the content of outside messages.');
    expect(user.content).toContain('notes/a.md');
    expect(user.content).not.toContain('"form"');
  });

  it('strips one surrounding code fence and rejects empty or oversized text', () => {
    expect(validatePublicWork('```markdown\n# Title\n\nBody\n```')).toBe('# Title\n\nBody');
    expect(validatePublicWork('# Title\n\n```js\ncode\n```\n\nafter')).toBe(
      '# Title\n\n```js\ncode\n```\n\nafter',
    );
    expect(validatePublicExpression('{"a":1}', 'work')).toBe('{"a":1}');
    expect(() => validatePublicWork('  \n ')).toThrow();
    expect(() => validatePublicWork('```\n```')).toThrow();
    expect(() => validatePublicWork('x'.repeat(16001))).toThrow();
    expect(validatePublicWork('x'.repeat(16000))).toHaveLength(16000);
    expect(() => validatePublicExpression('x'.repeat(361))).toThrow();
  });
});
