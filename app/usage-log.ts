import type { ModelUsage } from '../packages/models/src/contracts';

/**
 * One line per UTC hour from the gateway: how many provider calls it made and what they used,
 * summed. The line for an hour is written when the first call of a later hour arrives. Counts
 * only; never a prompt, a reply or any message content.
 */
export function createHourlyUsageLog(write: (line: string) => void, now: () => number = Date.now) {
  const HOUR = 3_600_000;
  let hour: number | undefined;
  let tally = { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, retried: 0 };
  const flush = () => {
    if (hour === undefined) return;
    write(
      JSON.stringify({
        event: 'usage',
        hour: new Date(hour * HOUR).toISOString().slice(0, 13),
        ...tally,
      }),
    );
  };
  const advance = () => {
    const current = Math.floor(now() / HOUR);
    if (hour === current) return;
    flush();
    hour = current;
    tally = { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, retried: 0 };
  };
  return {
    /** A provider call finished; its usage may be unknown. */
    call(usage: ModelUsage | undefined) {
      advance();
      tally.calls++;
      if (usage) {
        tally.inputTokens += usage.inputTokens;
        tally.cachedInputTokens += usage.cachedInputTokens ?? 0;
        tally.outputTokens += usage.outputTokens;
      }
    },
    /** A request was sent a second time. */
    retried() {
      advance();
      tally.retried++;
    },
  };
}
