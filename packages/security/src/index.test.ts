import { describe, expect, it } from 'vitest';
import { authorizeCommand, equalSecret, reserveModelCall } from './index';

describe('trusted policy boundaries', () => {
  it('rejects arbitrary tool operations and disconnected external workers', () => {
    expect(authorizeCommand({ type: 'shell', command: 'anything' }).allowed).toBe(false);
    expect(authorizeCommand({ type: 'delegate', task: 'build a project' }).allowed).toBe(false);
    expect(authorizeCommand({ type: 'rest' }).allowed).toBe(true);
  });
  it('reserves actual model attempts with daily rollover', () => {
    const ledger = { day: '2026-11-08', calls: 2, inputTokens: 0, outputTokens: 0 };
    expect(reserveModelCall(ledger, Date.parse('2026-11-08T10:00:00Z'), 2)).toBeNull();
    expect(reserveModelCall(ledger, Date.parse('2026-11-09T00:00:00Z'), 2)?.calls).toBe(1);
  });
  it('compares full owner credentials', () => {
    expect(equalSecret('secret', 'secret')).toBe(true);
    expect(equalSecret('secret', 'secrets')).toBe(false);
    expect(equalSecret('xxxxxx', 'secret')).toBe(false);
  });
});
