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
  describe('hourly model-call cap', () => {
    const base = { day: '2026-11-08', calls: 1, inputTokens: 0, outputTokens: 0 };
    const at = (time: string) => Date.parse(`2026-11-08T${time}Z`);
    it('refuses at the hourly limit while the daily limit has room', () => {
      const ledger = { ...base, hour: '2026-11-08T10', hourCalls: 2 };
      expect(reserveModelCall(ledger, at('10:30:00'), 10, 2)).toBeNull();
    });
    it('increments both counters on success', () => {
      const next = reserveModelCall(
        { ...base, hour: '2026-11-08T10', hourCalls: 1 },
        at('10:30:00'),
        10,
        2,
      );
      expect(next).toMatchObject({ calls: 2, hour: '2026-11-08T10', hourCalls: 2 });
    });
    it('resets the counter in the next UTC hour', () => {
      const ledger = { ...base, hour: '2026-11-08T10', hourCalls: 2 };
      expect(reserveModelCall(ledger, at('11:00:00'), 10, 2)).toMatchObject({
        calls: 2,
        hour: '2026-11-08T11',
        hourCalls: 1,
      });
    });
    it('still refuses at the daily limit when the hour has room', () => {
      const ledger = { ...base, calls: 3, hour: '2026-11-08T10', hourCalls: 0 };
      expect(reserveModelCall(ledger, at('10:30:00'), 3, 5)).toBeNull();
    });
    it('works with old ledgers that lack hour fields', () => {
      expect(reserveModelCall(base, at('10:30:00'), 10, 2)).toMatchObject({
        calls: 2,
        hour: '2026-11-08T10',
        hourCalls: 1,
      });
    });
    it('leaves hour fields alone without an hourly maximum', () => {
      const ledger = { ...base, hour: '2026-11-08T09', hourCalls: 7 };
      expect(reserveModelCall(ledger, at('10:30:00'), 10)).toEqual({ ...ledger, calls: 2 });
      expect(reserveModelCall(base, at('10:30:00'), 10)).toEqual({ ...base, calls: 2 });
    });
  });
  it('compares full owner credentials', () => {
    expect(equalSecret('secret', 'secret')).toBe(true);
    expect(equalSecret('secret', 'secrets')).toBe(false);
    expect(equalSecret('xxxxxx', 'secret')).toBe(false);
  });
});
