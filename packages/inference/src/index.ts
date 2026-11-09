import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { CharacterCommandSchema } from '@elsewhere/character-interfaces';
import type { DecisionContext } from '@elsewhere/character-runtime';
import {
  reflectionMessages,
  validateReflectionProposal,
  type ReflectionInput,
} from '../../adapters/src/models/reflection';
import type { HostResourceRegistry } from '../../identity/src/index';
import type { ModelUsage } from '../../models/src/contracts';
import type { SnapshotStore } from '../../persistence/src/index';
import { reserveModelCall } from '../../security/src/index';
import { decisionMessages } from '../../adapters/src/models/shared';
import {
  expressionMessages,
  validatePublicExpression,
  type PublicExpressionInput,
} from '../../adapters/src/models/expression';
import {
  DEFAULT_INFERENCE_TOKEN_BUDGET,
  InferenceTokenBudgetSchema,
  UsageAccountingSchema,
  emptyUsageAccounting,
  settleUsageAccounting,
  tokenBudgetFailure,
  type InferenceTokenBudget,
} from './usage-budget';
import {
  BrokerDecisionRequestSchema,
  BrokerErrorSchema,
  BrokerExpressionFrameSchema,
  BrokerExpressionRequestSchema,
  BrokerReflectionRequestSchema,
  BrokerUsageSchema,
  InferenceBindingSchema,
  InferenceDiagnosticSchema,
  encodeInferenceBinding,
  type InferenceBinding,
  type InferenceWorkload,
  type InferenceDiagnostic,
} from './contracts';

export * from './contracts';
export { DEFAULT_INFERENCE_TOKEN_BUDGET, type InferenceTokenBudget } from './usage-budget';

const allowanceSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    calls: z.number().int().min(0).safe(),
    inputTokens: z.number().int().min(0).safe(),
    outputTokens: z.number().int().min(0).safe(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    binding: InferenceBindingSchema,
    allowance: allowanceSchema,
    accounting: UsageAccountingSchema.optional(),
  })
  .strict();
export type InferenceBrokerState = z.infer<typeof stateSchema>;
export interface InferenceResult {
  value: unknown;
  usage?: ModelUsage;
}

/** Carries bounded usage only; raw provider errors remain inside the private process. */
export class InferenceDispatchError extends Error {
  constructor(
    readonly usage?: ModelUsage,
    readonly diagnostic?: InferenceDiagnostic,
  ) {
    super('Inference provider failed.');
  }
}
export interface InferenceBrokerOptions {
  token: string;
  binding: InferenceBinding;
  registry: Pick<HostResourceRegistry, 'resolve'>;
  identity: string;
  store: SnapshotStore<InferenceBrokerState>;
  maxCallsPerDay?: number;
  tokenBudget?: Partial<InferenceTokenBudget>;
  requestBodyTimeoutMs?: number;
  timeoutMs?: number;
  now?: () => number;
  isAvailable?: () => boolean;
  decision: (context: DecisionContext, signal: AbortSignal) => Promise<InferenceResult>;
  reflection: (input: ReflectionInput, signal: AbortSignal) => Promise<InferenceResult>;
  expression?: (
    input: PublicExpressionInput,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ) => Promise<InferenceResult>;
}

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readRequest(request: IncomingMessage): Promise<unknown> {
  if (
    request.headers['content-type']?.split(';')[0].trim() !== 'application/json' ||
    request.headers['content-encoding']
  )
    throw new RequestFailure(400, 'invalid_request');
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 96000))
    throw new RequestFailure(413, 'request_too_large');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > 96000) throw new RequestFailure(413, 'request_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestFailure(400, 'invalid_request');
  }
}

/** Private owner-scoped execution service. This factory never starts a public listener. */
export async function createInferenceBroker(options: InferenceBrokerOptions) {
  const binding = InferenceBindingSchema.safeParse(options.binding);
  const maximum = options.maxCallsPerDay ?? 20;
  const timeoutMs = options.timeoutMs ?? 35000;
  const bodyTimeoutMs = options.requestBodyTimeoutMs ?? 5000;
  const tokenBudget = InferenceTokenBudgetSchema.safeParse({
    ...DEFAULT_INFERENCE_TOKEN_BUDGET,
    ...options.tokenBudget,
  });
  if (
    !binding.success ||
    !tokenBudget.success ||
    !/^[^\s\x00-\x1f\x7f]{32,512}$/.test(options.token) ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 1000 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 60000 ||
    !Number.isSafeInteger(bodyTimeoutMs) ||
    bodyTimeoutMs < 100 ||
    bodyTimeoutMs > 10000 ||
    !options.identity ||
    options.identity.length > 4000
  )
    throw new Error('Private inference broker configuration is invalid.');
  const now = options.now ?? Date.now;
  const clock = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid broker clock.');
    return value;
  };
  const lifetime = new AbortController();
  let stopping = false,
    halted = false,
    active = false;
  let activeCompletion: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const saved = await options.store.load();
  let version = saved?.version ?? 0;
  let state: InferenceBrokerState;
  if (saved) {
    const parsed = stateSchema.safeParse(saved.value);
    if (!parsed.success || JSON.stringify(parsed.data.binding) !== JSON.stringify(binding.data))
      throw new Error('Private inference allowance is invalid or belongs to another binding.');
    state = parsed.data;
    if (state.accounting && state.accounting.day !== state.allowance.day)
      throw new Error('Private inference usage accounting has an invalid day.');
    const needsAccounting = state.accounting === undefined;
    const accounting = state.accounting ?? emptyUsageAccounting(state.allowance.day);
    state.accounting = settleUsageAccounting(accounting, undefined);
    if (needsAccounting || accounting.pending) version = await options.store.save(state, version);
  } else {
    state = {
      version: 1,
      binding: binding.data,
      allowance: {
        day: new Date(clock()).toISOString().slice(0, 10),
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      accounting: emptyUsageAccounting(new Date(clock()).toISOString().slice(0, 10)),
    };
    version = await options.store.save(state, version);
  }
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${options.token}`);
  const expectedBinding = encodeInferenceBinding(binding.data);
  const matchingBinding = (request: IncomingMessage) =>
    request.headers['x-elsewhere-inference-binding'] === expectedBinding;
  const authenticated = (request: IncomingMessage) =>
    typeof request.headers.authorization === 'string' &&
    request.headers.authorization.length <= 1024 &&
    timingSafeEqual(digest(request.headers.authorization), expected);
  const allowed = (workload: InferenceWorkload) => {
    try {
      const capabilityId = `model.${workload}`;
      const resolution = options.registry.resolve({ ...binding.data, capabilityId }, clock());
      return (
        resolution.decision === 'eligible' &&
        resolution.capabilityId === capabilityId &&
        resolution.worldId === binding.data.worldId &&
        resolution.ownerUserId === binding.data.ownerUserId &&
        resolution.characterId === binding.data.characterId &&
        resolution.connectionId === binding.data.connectionId
      );
    } catch {
      return false;
    }
  };
  const available = () => {
    try {
      return !halted && !stopping && options.isAvailable?.() !== false;
    } catch {
      return false;
    }
  };
  const persist = async () => {
    try {
      version = await options.store.save(state, version);
    } catch {
      halted = true;
      throw new RequestFailure(503, 'storage_unavailable');
    }
  };
  const usageView = (timestamp: number) => {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    return state.allowance.day < day
      ? {
          allowance: { day, calls: 0, inputTokens: 0, outputTokens: 0 },
          accounting: emptyUsageAccounting(day),
        }
      : { allowance: state.allowance, accounting: state.accounting! };
  };
  const retryAfterReset = (timestamp: number) =>
    Math.max(
      1000,
      Math.min(
        86400000,
        Date.parse(`${usageView(timestamp).allowance.day}T00:00:00.000Z`) + 86400000 - timestamp,
      ),
    );
  function send(response: ServerResponse, status: number, body: unknown) {
    if (response.writableEnded || response.destroyed) return;
    if (response.headersSent) {
      const failure = BrokerErrorSchema.safeParse(body);
      response.end(
        JSON.stringify({
          type: 'error',
          ...(failure.success ? failure.data : { error: 'provider_unavailable' }),
        }) + '\n',
      );
      return;
    }
    const data = JSON.stringify(body);
    if (status >= 400) response.setHeader('Connection', 'close');
    if (
      body &&
      typeof body === 'object' &&
      'retryAfterMs' in body &&
      typeof body.retryAfterMs === 'number'
    )
      response.setHeader('Retry-After', String(Math.ceil(body.retryAfterMs / 1000)));
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    });
    response.end(data);
  }
  function sendExpressionFrame(response: ServerResponse, frame: unknown, complete = false) {
    if (response.writableEnded || response.destroyed) return;
    const parsed = BrokerExpressionFrameSchema.parse(frame);
    if (!response.headersSent)
      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-accel-buffering': 'no',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      });
    const data = JSON.stringify(parsed) + '\n';
    if (complete) response.end(data);
    else response.write(data);
  }
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      send(response, 200, { status: 'alive' });
      return;
    }
    // There is no browser OAuth, public inference or cross-origin access here.
    if (!authenticated(request) || request.headers.origin || request.headers['sec-fetch-site']) {
      send(response, 401, { error: 'unauthorized' });
      return;
    }
    if (request.method === 'GET' && request.url === '/readyz') {
      if (!matchingBinding(request)) {
        send(response, 403, { error: 'not_authorized' });
        return;
      }
      const view = usageView(clock());
      const ready =
        available() &&
        view.allowance.calls < maximum &&
        !tokenBudgetFailure(view.allowance, view.accounting, tokenBudget.data) &&
        (allowed('decision') ||
          allowed('reflection') ||
          (!!options.expression && allowed('expression')));
      send(response, ready ? 200 : 503, { ready });
      return;
    }
    const workload =
      request.method === 'POST' && request.url === '/v1/decision'
        ? 'decision'
        : request.method === 'POST' && request.url === '/v1/reflection'
          ? 'reflection'
          : request.method === 'POST' && request.url === '/v1/expression'
            ? 'expression'
            : undefined;
    if (!workload) {
      send(response, 404, { error: 'invalid_request' });
      return;
    }
    if (!matchingBinding(request)) {
      send(response, 403, { error: 'not_authorized' });
      return;
    }
    if (!allowed(workload)) {
      send(response, 403, { error: 'not_authorized' });
      return;
    }
    if (!available() || (workload === 'expression' && !options.expression)) {
      send(response, 503, { error: 'unavailable', retryAfterMs: 60000 });
      return;
    }
    if (active) {
      send(response, 409, { error: 'busy', retryAfterMs: 1000 });
      return;
    }
    active = true;
    activeCompletion = (async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let reserved = false;
      let dispatched = false;
      let settled = false;
      let reportedUsage: ModelUsage | undefined;
      let streamedText = '';
      let invalidExpressionDelta = false;
      const settle = async (usage: ModelUsage | undefined) => {
        if (settled) return;
        settled = true;
        state = {
          ...state,
          accounting: settleUsageAccounting(state.accounting!, usage),
          allowance: {
            ...state.allowance,
            inputTokens: state.allowance.inputTokens + (usage?.inputTokens ?? 0),
            outputTokens: state.allowance.outputTokens + (usage?.outputTokens ?? 0),
          },
        };
        await persist();
      };
      const dispatch = new AbortController();
      const abort = () => dispatch.abort();
      const disconnected = () => {
        if (!response.writableEnded) dispatch.abort();
      };
      response.once('close', disconnected);
      lifetime.signal.addEventListener('abort', abort, { once: true });
      try {
        deadline = setTimeout(() => {
          dispatch.abort();
          // Finishing a response alone does not end an unfinished IncomingMessage iterator.
          response.once('finish', () => request.destroy());
          send(response, 408, { error: 'request_timeout', retryAfterMs: 1000 });
        }, bodyTimeoutMs);
        const body = await readRequest(request);
        clearTimeout(deadline);
        deadline = undefined;
        if (dispatch.signal.aborted || request.aborted || response.writableEnded) return;
        const parsed =
          workload === 'decision'
            ? BrokerDecisionRequestSchema.safeParse(body)
            : workload === 'reflection'
              ? BrokerReflectionRequestSchema.safeParse(body)
              : BrokerExpressionRequestSchema.safeParse(body);
        if (!parsed.success) throw new RequestFailure(400, 'invalid_request');
        const decision =
          workload === 'decision'
            ? { identity: options.identity, ...BrokerDecisionRequestSchema.parse(body).context }
            : undefined;
        const reflection =
          workload === 'reflection'
            ? { identity: options.identity, ...BrokerReflectionRequestSchema.parse(body).input }
            : undefined;
        const expression =
          workload === 'expression' ? BrokerExpressionRequestSchema.parse(body).input : undefined;
        let messages;
        try {
          messages = decision
            ? decisionMessages(decision)
            : reflection
              ? reflectionMessages(reflection)
              : expressionMessages(options.identity, expression!);
        } catch {
          throw new RequestFailure(400, 'invalid_request');
        }
        // UTF-8 message bytes plus framing are a conservative local admission estimate,
        // not a provider tokenizer or an output-generation limit.
        const inputReserve = Buffer.byteLength(JSON.stringify(messages), 'utf8') + 512;
        const timestamp = clock();
        // Backwards wall-clock changes cannot reopen an earlier day's allowance.
        const view = usageView(timestamp);
        const budgetFailure = tokenBudgetFailure(
          view.allowance,
          view.accounting,
          tokenBudget.data,
          inputReserve,
        );
        if (budgetFailure) {
          send(response, budgetFailure === 'request_too_large' ? 413 : 429, {
            error: budgetFailure,
            ...(budgetFailure === 'request_too_large'
              ? {}
              : { retryAfterMs: retryAfterReset(timestamp) }),
          });
          return;
        }
        const realDay = new Date(timestamp).toISOString().slice(0, 10);
        const current =
          state.allowance.day > realDay
            ? state.allowance
            : reserveModelCall(state.allowance, timestamp, maximum);
        if (!current || (state.allowance.day > realDay && state.allowance.calls >= maximum)) {
          const reset = retryAfterReset(timestamp);
          send(response, 429, { error: 'daily_limit', retryAfterMs: reset });
          return;
        }
        state = {
          ...state,
          allowance:
            state.allowance.day > realDay
              ? { ...state.allowance, calls: state.allowance.calls + 1 }
              : current,
          accounting: {
            ...view.accounting,
            pending: {
              inputTokens: inputReserve,
              outputTokens: tokenBudget.data.outputTokenReserve,
            },
          },
        };
        await persist(); // Durable reservation is never refunded for failure or restart.
        reserved = true;
        if (!allowed(workload)) throw new RequestFailure(403, 'not_authorized');
        if (!available() || lifetime.signal.aborted) throw new RequestFailure(503, 'unavailable');
        deadline = setTimeout(() => {
          dispatch.abort();
          send(response, 504, { error: 'deadline_exceeded', retryAfterMs: 60000 });
        }, timeoutMs);
        let result: InferenceResult;
        try {
          dispatched = true;
          result = decision
            ? await options.decision(decision, dispatch.signal)
            : reflection
              ? await options.reflection(reflection, dispatch.signal)
              : await options.expression!(expression!, dispatch.signal, (text) => {
                  if (dispatch.signal.aborted || response.destroyed || response.writableEnded)
                    return;
                  if (typeof text !== 'string' || streamedText.length + text.length > 360) {
                    invalidExpressionDelta = true;
                    return;
                  }
                  if (!text) return;
                  streamedText += text;
                  sendExpressionFrame(response, { type: 'delta', text });
                });
        } catch (error) {
          const reported =
            error instanceof InferenceDispatchError
              ? BrokerUsageSchema.safeParse(error.usage)
              : undefined;
          await settle(reported?.success ? reported.data : undefined);
          const detail =
            error instanceof InferenceDispatchError
              ? InferenceDiagnosticSchema.safeParse(error.diagnostic)
              : undefined;
          const diagnostic = detail?.success ? detail.data : undefined;
          const invalidAction =
            decision && diagnostic && ['invalid_action', 'invalid_json'].includes(diagnostic.code);
          send(response, invalidAction ? 400 : 503, {
            error: invalidAction ? 'invalid_action' : 'provider_unavailable',
            retryAfterMs: 60000,
            ...(diagnostic ? { diagnostic } : {}),
            ...(reported?.success ? { usage: reported.data } : {}),
          });
          return;
        }
        const reported = BrokerUsageSchema.safeParse(result.usage);
        reportedUsage = reported.success ? reported.data : undefined;
        await settle(reportedUsage);
        if (invalidExpressionDelta) throw new RequestFailure(400, 'invalid_expression');
        let value: unknown;
        if (expression) {
          try {
            value = validatePublicExpression(result.value);
            if (streamedText && validatePublicExpression(streamedText) !== value)
              throw Error('Mismatched note.');
          } catch {
            throw new RequestFailure(400, 'invalid_expression');
          }
        } else
          value = decision
            ? CharacterCommandSchema.parse(result.value)
            : validateReflectionProposal(result.value, reflection!);
        if (!dispatch.signal.aborted) {
          const completed = { value, ...(reported.success ? { usage: reported.data } : {}) };
          if (expression) sendExpressionFrame(response, { type: 'complete', ...completed }, true);
          else send(response, 200, completed);
        }
      } catch (error) {
        const usage = reportedUsage ? { usage: reportedUsage } : {};
        if (error instanceof RequestFailure)
          send(response, error.status, { error: error.code, ...usage });
        else send(response, 503, { error: 'provider_unavailable', retryAfterMs: 60000, ...usage });
      } finally {
        clearTimeout(deadline);
        lifetime.signal.removeEventListener('abort', abort);
        response.removeListener('close', disconnected);
        if (reserved && !settled && !halted)
          await settle(
            dispatched ? undefined : { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
          );
        active = false;
      }
    })();
    void activeCompletion.catch(() => {
      halted = true;
      send(response, 503, { error: 'storage_unavailable' });
    });
  });
  server.maxConnections = 16;
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  server.setTimeout(Math.max(10000, timeoutMs + bodyTimeoutMs + 1000), (socket) =>
    socket.destroy(),
  );
  return {
    server,
    getState: () => structuredClone(state),
    close() {
      if (!closing)
        closing = (async () => {
          stopping = true;
          lifetime.abort();
          const closed = new Promise<void>((resolve) => server.close(() => resolve()));
          server.closeIdleConnections();
          server.closeAllConnections();
          await closed;
          try {
            await activeCompletion;
          } finally {
            await options.store.close();
          }
        })();
      return closing;
    },
  };
}
