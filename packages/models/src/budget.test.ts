import { expect, it } from 'vitest';
import { modelProfile } from '../../../tests/model-fixtures';
import { reserveRoutingBudget, settleRoutingBudget } from './budget';

const now = Date.UTC(2026, 10, 8);
const estimate = { profileId: 'cf-routine', workload: 'decision' as const, maximumMicroUsd: 200 };
const profile = modelProfile();

it('refuses malformed or underfunded imported ledgers rather than minting a new allowance', () => {
  const ledger = reserveRoutingBudget(undefined, estimate, 300, now, 'one')!;
  ledger.days['2026-11-08'].microUsd = 0;
  expect(() => reserveRoutingBudget(ledger, estimate, 300, now, 'two')).toThrow('invalid');
  expect(() => settleRoutingBudget(ledger, 'one', profile, undefined, false)).toThrow('invalid');
});

it('keeps unknown costs charged, reconciles cached reads, and settles once', () => {
  const ledger = reserveRoutingBudget(undefined, estimate, 300, now, 'one')!;
  expect(ledger.days['2026-11-08'].microUsd).toBe(200);
  expect(reserveRoutingBudget(structuredClone(ledger), estimate, 300, now, 'two')).toBeNull();
  const unknown = settleRoutingBudget(ledger, 'one', profile, undefined, true);
  expect(unknown.days['2026-11-08'].microUsd).toBe(200);
  const usage = { inputTokens: 100, outputTokens: 10, cachedInputTokens: 80 };
  const settled = settleRoutingBudget(ledger, 'one', profile, usage, false);
  expect(settled.days['2026-11-08']).toMatchObject({
    microUsd: 48,
    cachedInputTokens: 80,
    attempts: 1,
  });
  expect(settleRoutingBudget(settled, 'one', profile, usage, false)).toEqual(settled);
  expect(settleRoutingBudget(unknown, 'one', profile, usage, false)).toEqual(unknown);
});

it('does not refund malformed usage and records overruns instead of hiding them', () => {
  const ledger = reserveRoutingBudget(undefined, estimate, 300, now, 'one')!;
  const invalid = settleRoutingBudget(
    ledger,
    'one',
    profile,
    { inputTokens: 10, outputTokens: -1, cachedInputTokens: 20 },
    true,
  );
  expect(invalid.days['2026-11-08'].microUsd).toBe(200);
  const overrun = settleRoutingBudget(
    ledger,
    'one',
    profile,
    { inputTokens: 1000, outputTokens: 1000, cachedInputTokens: 0 },
    false,
  );
  expect(overrun.days['2026-11-08'].microUsd).toBe(3000);
  expect(reserveRoutingBudget(overrun, estimate, 300, now, 'two')).toBeNull();
});

it('keeps midnight settlements on their original day and rejects clock rollback', () => {
  const first = reserveRoutingBudget(undefined, estimate, 300, now, 'one')!;
  const second = reserveRoutingBudget(first, estimate, 300, now + 86_400_000, 'two')!;
  const settled = settleRoutingBudget(
    second,
    'one',
    profile,
    { inputTokens: 10, outputTokens: 0, cachedInputTokens: 0 },
    false,
  );
  expect(settled.days['2026-11-08'].microUsd).toBe(10);
  expect(settled.days['2026-11-09'].microUsd).toBe(200);
  expect(reserveRoutingBudget(settled, estimate, 300, now, 'three')).toBeNull();
});

it('bounds receipts without replenishing totals when old completed records are evicted', () => {
  let ledger = reserveRoutingBudget(
    undefined,
    { ...estimate, maximumMicroUsd: 1 },
    1000,
    now,
    '0',
  )!;
  for (let i = 1; i < 140; i++) {
    ledger = settleRoutingBudget(ledger, String(i - 1), profile, undefined, false);
    ledger = reserveRoutingBudget(
      ledger,
      { ...estimate, maximumMicroUsd: 1 },
      1000,
      now,
      String(i),
    )!;
  }
  expect(ledger.receipts).toHaveLength(128);
  expect(ledger.days['2026-11-08']).toMatchObject({ microUsd: 140, attempts: 140 });
});
