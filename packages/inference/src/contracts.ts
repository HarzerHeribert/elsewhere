import { z } from 'zod';
import { DECISION_DIAGNOSTIC_FIELDS } from '@elsewhere/character-runtime';
import { PublicExpressionInputSchema } from '../../adapters/src/models/expression';
import type { JsonObject, DecisionContext } from '@elsewhere/character-runtime';
import { ReflectionInputSchema } from '../../adapters/src/models/reflection';
import { canonicalJson } from '../../models/src/data';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

/** Fixed by the trusted host/service credential; never selected by an HTTP caller. */
export const InferenceBindingSchema = z
  .object({
    worldId: identifier,
    ownerUserId: identifier,
    characterId: identifier,
    connectionId: identifier,
  })
  .strict();
export type InferenceBinding = z.infer<typeof InferenceBindingSchema>;
export function encodeInferenceBinding(binding: InferenceBinding): string {
  const parsed = InferenceBindingSchema.safeParse(binding);
  if (!parsed.success) throw new Error('Private inference binding is invalid.');
  return Buffer.from(JSON.stringify(parsed.data)).toString('base64url');
}
export type InferenceWorkload = 'decision' | 'reflection' | 'expression';

export const InferenceDiagnosticSchema = z
  .object({
    code: z.enum(['invalid_json', 'invalid_action', 'invalid_reflection', 'provider_response']),
    fields: z.array(z.enum(DECISION_DIAGNOSTIC_FIELDS)).max(8),
    providerCode: z
      .enum([
        'request_failed',
        'response_incomplete',
        'invalid_completed_response',
        'invalid_completed_output',
        'unexpected_output_capability',
        'stream_interrupted',
        'invalid_stream_event',
        'selected_model_unavailable',
        'network_or_stream_unavailable',
      ])
      .optional(),
  })
  .strict();
export type InferenceDiagnostic = z.infer<typeof InferenceDiagnosticSchema>;

/** Iterative bounds avoid handing deeply nested JSON to recursive validation/formatting. */
function boundedJsonObject(value: Record<string, unknown>): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let entries = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++entries > 3000 || item.depth > 12) return false;
    const value = item.value;
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > 8000) return false;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return false;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 64) return false;
      for (const child of value) pending.push({ value: child, depth: item.depth + 1 });
      continue;
    }
    if (!value || typeof value !== 'object') return false;
    const record = Object.entries(value);
    if (record.length > 64) return false;
    for (const [key, child] of record) {
      if (key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) return false;
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return true;
}
const jsonObject = z
  .record(z.string().max(128), z.unknown())
  .refine(boundedJsonObject)
  .transform((value) => value as JsonObject);

/** Persona/instructions come from the broker's character definition, not the world caller. */
export const BrokerDecisionContextSchema = z
  .object({
    state: jsonObject,
    intentions: z.array(z.string().max(1000)).max(8),
    memories: z
      .array(
        z
          .object({
            memoryId: identifier,
            sourceEventId: identifier,
            summary: z.string().max(1000),
            score: z.number().finite(),
          })
          .strict(),
      )
      .max(16),
    observations: jsonObject,
    outsideMessages: z
      .array(z.object({ source: z.string().max(250), text: z.string().max(1500) }).strict())
      .max(16),
  })
  .strict();

export const BrokerDecisionRequestSchema = z
  .object({ context: BrokerDecisionContextSchema })
  .strict();
export const BrokerReflectionRequestSchema = z
  .object({
    input: ReflectionInputSchema.omit({ identity: true }),
  })
  .strict();
export const BrokerExpressionRequestSchema = z
  .object({ input: PublicExpressionInputSchema })
  .strict();

export function decisionWireContext(context: DecisionContext) {
  const { identity: _identity, ...data } = context;
  // Match direct providers when JsonObject contains optional undefined object fields.
  const parsed = BrokerDecisionContextSchema.safeParse(JSON.parse(canonicalJson(data)));
  if (!parsed.success) throw new Error('Inference context is invalid or exceeds its bounds.');
  return parsed.data;
}

export const BrokerUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0).max(1_000_000_000),
    outputTokens: z.number().int().min(0).max(1_000_000_000),
    cachedInputTokens: z.number().int().min(0).max(1_000_000_000),
  })
  .strict()
  .refine((value) => value.cachedInputTokens <= value.inputTokens);

export const BrokerResponseSchema = z
  .object({
    value: z.unknown(),
    usage: BrokerUsageSchema.optional(),
  })
  .strict();

export const BrokerErrorSchema = z
  .object({
    error: z.enum([
      'unauthorized',
      'not_authorized',
      'invalid_request',
      'invalid_expression',
      'invalid_action',
      'request_too_large',
      'busy',
      'unavailable',
      'daily_limit',
      'daily_token_limit',
      'usage_unknown',
      'request_timeout',
      'provider_unavailable',
      'deadline_exceeded',
      'storage_unavailable',
    ]),
    retryAfterMs: z.number().int().min(1000).max(86_400_000).optional(),
    usage: BrokerUsageSchema.optional(),
    diagnostic: InferenceDiagnosticSchema.optional(),
  })
  .strict();

/** Only deliberately authored public text crosses this stream, never provider reasoning events. */
export const BrokerExpressionFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string().min(1).max(360) }).strict(),
  z
    .object({
      type: z.literal('complete'),
      value: z.string().max(360),
      usage: BrokerUsageSchema.optional(),
    })
    .strict(),
  BrokerErrorSchema.extend({ type: z.literal('error') }),
]);
