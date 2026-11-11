import { z } from 'zod';
import type { ModelUsage } from '../../models/src/contracts';

export const DEFAULT_INFERENCE_TOKEN_BUDGET = Object.freeze({
  maxInputTokensPerDay: 3_500_000,
  maxOutputTokensPerDay: 100_000,
  maxInputTokensPerRequest: 128_000,
  outputTokenReserve: 2_000,
  // A timeout or a broken stream ends without a usage report (a request the provider refuses
  // outright reports zero instead). Their retained reservations stay charged against the
  // token caps above, so this count only stops a runaway of such calls.
  maxUnknownUsageCallsPerDay: 20,
});
export const InferenceTokenBudgetSchema = z.object({
  maxInputTokensPerDay: z.number().int().min(1).max(1_000_000_000),
  maxOutputTokensPerDay: z.number().int().min(1).max(1_000_000_000),
  maxInputTokensPerRequest: z.number().int().min(1).max(128_000),
  outputTokenReserve: z.number().int().min(1).max(1_000_000),
  maxUnknownUsageCallsPerDay: z.number().int().min(1).max(100),
});
export type InferenceTokenBudget = z.infer<typeof InferenceTokenBudgetSchema>;
const count = z.number().int().min(0).safe();
export const UsageAccountingSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    unknownCalls: count,
    unreportedInputTokens: count,
    unreportedOutputTokens: count,
    pending: z.object({ inputTokens: count, outputTokens: count }).strict().optional(),
  })
  .strict();
export type UsageAccounting = z.infer<typeof UsageAccountingSchema>;

export function emptyUsageAccounting(day: string): UsageAccounting {
  return { day, unknownCalls: 0, unreportedInputTokens: 0, unreportedOutputTokens: 0 };
}

/** A crash cannot erase an admitted request whose final provider usage was never recorded. */
export function settleUsageAccounting(
  accounting: UsageAccounting,
  usage: ModelUsage | undefined,
): UsageAccounting {
  const { pending, ...settled } = accounting;
  if (!pending || usage) return settled;
  return {
    ...settled,
    unknownCalls: settled.unknownCalls + 1,
    unreportedInputTokens: settled.unreportedInputTokens + pending.inputTokens,
    unreportedOutputTokens: settled.unreportedOutputTokens + pending.outputTokens,
  };
}

export function tokenBudgetFailure(
  reported: { inputTokens: number; outputTokens: number },
  accounting: UsageAccounting,
  budget: InferenceTokenBudget,
  inputReserve = 0,
): 'usage_unknown' | 'daily_token_limit' | 'request_too_large' | undefined {
  if (accounting.unknownCalls >= budget.maxUnknownUsageCallsPerDay) return 'usage_unknown';
  if (inputReserve > budget.maxInputTokensPerRequest) return 'request_too_large';
  if (
    reported.inputTokens + accounting.unreportedInputTokens >= budget.maxInputTokensPerDay ||
    reported.inputTokens + accounting.unreportedInputTokens + inputReserve >
      budget.maxInputTokensPerDay ||
    reported.outputTokens + accounting.unreportedOutputTokens + budget.outputTokenReserve >
      budget.maxOutputTokensPerDay
  )
    return 'daily_token_limit';
}
