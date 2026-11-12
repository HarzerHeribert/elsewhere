import { expect, it } from 'vitest';
import { createHourlyUsageLog } from './usage-log';

const HOUR = 3_600_000;
const start = Date.UTC(2026, 10, 12, 14, 5);

it('writes one summed line for an hour when the first call of the next hour arrives', () => {
  const lines: string[] = [];
  let at = start;
  const log = createHourlyUsageLog(
    (line) => lines.push(line),
    () => at,
  );
  log.call({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 60 });
  log.retried();
  log.call({ inputTokens: 100, outputTokens: 5, cachedInputTokens: 0 });
  log.call(undefined);
  at = start + 20 * 60_000;
  log.call({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 });
  expect(lines).toEqual([]);
  at = start + HOUR;
  log.call({ inputTokens: 7, outputTokens: 2, cachedInputTokens: 3 });
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    {
      event: 'usage',
      hour: '2026-11-12T14',
      calls: 4,
      inputTokens: 201,
      cachedInputTokens: 60,
      outputTokens: 16,
      retried: 1,
    },
  ]);
  expect(lines[0]).not.toMatch(/prompt|reply|text/i);
});
