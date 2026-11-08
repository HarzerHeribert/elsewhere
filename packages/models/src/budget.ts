import {
  WORKLOADS,
  type AttemptEstimate,
  type ModelProfile,
  type ModelUsage,
  type ModelWorkload,
} from './contracts';

export interface RoutingLedger {
  version: 1;
  days: Record<
    string,
    {
      microUsd: number;
      attempts: number;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
    }
  >;
  receipts: Array<{
    id: string;
    day: string;
    profileId: string;
    workload: ModelWorkload;
    reserved: number;
    status: 'pending' | 'complete' | 'failed';
    usage?: ModelUsage;
    charged?: number;
  }>;
}

/** Persisted allowances fail closed; a malformed import must not replenish a real budget. */
export function assertRoutingLedger(value: RoutingLedger): void {
  const count = (item: unknown) => Number.isSafeInteger(item) && (item as number) >= 0;
  const fail = () => {
    throw new Error('Stored model routing allowance is invalid.');
  };
  if (
    !value ||
    value.version !== 1 ||
    !value.days ||
    typeof value.days !== 'object' ||
    Array.isArray(value.days) ||
    !Array.isArray(value.receipts) ||
    value.receipts.length > 128 ||
    Object.keys(value.days).length > 2
  )
    fail();
  for (const [date, day] of Object.entries(value.days))
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      !day ||
      ![day.microUsd, day.attempts, day.inputTokens, day.outputTokens, day.cachedInputTokens].every(
        count,
      ) ||
      day.cachedInputTokens > day.inputTokens
    )
      fail();
  const ids = new Set<string>();
  for (const receipt of value.receipts) {
    if (
      !receipt ||
      typeof receipt.id !== 'string' ||
      !receipt.id ||
      receipt.id.length > 100 ||
      ids.has(receipt.id) ||
      typeof receipt.day !== 'string' ||
      !Object.hasOwn(value.days, receipt.day) ||
      typeof receipt.profileId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(receipt.profileId) ||
      !WORKLOADS.includes(receipt.workload) ||
      !count(receipt.reserved) ||
      !['pending', 'complete', 'failed'].includes(receipt.status) ||
      (receipt.charged !== undefined && !count(receipt.charged)) ||
      (receipt.usage !== undefined && !validUsage(receipt.usage)) ||
      (receipt.status === 'pending' &&
        (receipt.charged !== undefined || receipt.usage !== undefined)) ||
      (receipt.status !== 'pending' && receipt.charged === undefined)
    )
      fail();
    ids.add(receipt.id);
  }
  for (const [date, day] of Object.entries(value.days)) {
    const receipts = value.receipts.filter((receipt) => receipt.day === date);
    if (
      day.attempts < receipts.length ||
      day.microUsd <
        receipts.reduce((sum, receipt) => sum + (receipt.charged ?? receipt.reserved), 0)
    )
      fail();
  }
}

export function validUsage(value: ModelUsage | undefined): value is ModelUsage {
  return (
    !!value &&
    [value.inputTokens, value.outputTokens, value.cachedInputTokens].every(
      (count) => Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000_000,
    ) &&
    value.cachedInputTokens <= value.inputTokens
  );
}
export function modelCost(
  profile: ModelProfile,
  input: number,
  output: number,
  cached = 0,
): number {
  // USD/million tokens equals micro-USD/token. Round upward, retaining sub-cent usage.
  return Math.ceil(
    (input - cached) * profile.rates.inputUsdPerMillion +
      cached * profile.rates.cachedInputUsdPerMillion +
      output * profile.rates.outputUsdPerMillion,
  );
}
export function reserveRoutingBudget(
  previous: RoutingLedger | undefined,
  estimate: AttemptEstimate,
  dailyMaximum: number,
  now: number,
  id: string,
): RoutingLedger | null {
  if (previous) assertRoutingLedger(previous);
  const ledger: RoutingLedger = structuredClone(previous ?? { version: 1, days: {}, receipts: [] });
  const day = new Date(now).toISOString().slice(0, 10);
  // A clock rollback must not create a fresh allowance for an earlier date.
  if (Object.keys(ledger.days).some((date) => date > day)) return null;
  const earliest = new Date(now - 86_400_000).toISOString().slice(0, 10);
  for (const date of Object.keys(ledger.days)) if (date < earliest) delete ledger.days[date];
  ledger.receipts = ledger.receipts.filter((receipt) => receipt.day >= earliest);
  while (ledger.receipts.length >= 128) {
    const terminal = ledger.receipts.findIndex((receipt) => receipt.status !== 'pending');
    if (terminal < 0) return null;
    ledger.receipts.splice(terminal, 1);
  }
  const current = ledger.days[day] ?? {
    microUsd: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };
  if (
    !Number.isSafeInteger(estimate.maximumMicroUsd) ||
    estimate.maximumMicroUsd < 0 ||
    !Number.isSafeInteger(dailyMaximum) ||
    dailyMaximum < 0 ||
    current.microUsd + estimate.maximumMicroUsd > dailyMaximum ||
    ledger.receipts.some((receipt) => receipt.id === id)
  )
    return null;
  current.microUsd += estimate.maximumMicroUsd;
  current.attempts++;
  ledger.days[day] = current;
  ledger.receipts.push({
    id,
    day,
    profileId: estimate.profileId,
    workload: estimate.workload,
    reserved: estimate.maximumMicroUsd,
    status: 'pending',
  });
  return ledger;
}

export function settleRoutingBudget(
  previous: RoutingLedger,
  id: string,
  profile: ModelProfile,
  usage: ModelUsage | undefined,
  failed: boolean,
): RoutingLedger {
  assertRoutingLedger(previous);
  const ledger = structuredClone(previous);
  const receipt = ledger.receipts.find((item) => item.id === id);
  if (!receipt || receipt.status !== 'pending') return ledger;
  if (receipt.profileId !== profile.id) throw new Error('Model reservation profile mismatch.');
  const day = ledger.days[receipt.day];
  receipt.status = failed ? 'failed' : 'complete';
  receipt.charged = receipt.reserved;
  if (validUsage(usage)) {
    receipt.usage = structuredClone(usage);
    // An unexpectedly large reported usage is recorded as an overrun, never silently clamped.
    receipt.charged = modelCost(
      profile,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens,
    );
    day.microUsd += receipt.charged - receipt.reserved;
    day.inputTokens += usage.inputTokens;
    day.outputTokens += usage.outputTokens;
    day.cachedInputTokens += usage.cachedInputTokens;
  }
  return ledger;
}
