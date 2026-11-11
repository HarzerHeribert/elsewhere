import type { CharacterDecision } from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';
import { InvalidDecisionError, invalidDecisionFields } from '@elsewhere/character-runtime';
import { CharacterDecisionSchema } from '@elsewhere/character-interfaces';
import {
  BrokerDecisionRequestSchema,
  BrokerErrorSchema,
  BrokerExpressionFrameSchema,
  BrokerExpressionRequestSchema,
  BrokerReflectionRequestSchema,
  BrokerResponseSchema,
  decisionWireContext,
  encodeInferenceBinding,
  type InferenceBinding,
  type InferenceWorkload,
  type InferenceDiagnostic,
} from '../../../inference/src/contracts';
import type { ModelUsage } from '../../../models/src/contracts';
import { pinnedHttpsFetch } from '../../../inference/src/pinned-https';
import {
  validateReflectionProposal,
  type ReflectionInput,
  type ReflectionProvider,
} from './reflection';
import {
  validatePublicExpression,
  type ExpressionProvider,
  type PublicExpressionInput,
} from './expression';

export interface BrokerModelOptions {
  baseUrl: string;
  token: string;
  caCertificate?: string;
  expectedBinding: InferenceBinding;
  timeoutMs?: number;
  /** Explicit opt-in for a deployment's private service DNS/RFC1918 network only. */
  allowPrivateHttp?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  onUsage?: (input: number, output: number) => void;
  onUsageDetails?: (usage: ModelUsage | undefined) => void;
}
export class BrokerModelError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly diagnostic?: InferenceDiagnostic,
  ) {
    super(`Private inference service: ${code}${status ? ` (HTTP ${status})` : ''}.`);
  }
}

function privateHttpHost(host: string) {
  if (/^[a-zA-Z0-9-]+$/.test(host) || host.endsWith('.internal')) return true;
  const octets = host.split('.').map(Number);
  return (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168))
  );
}

/** No OAuth tokens or provider configuration exist in the world runtime's client. */
export class BrokerModelClient {
  private readonly base: URL;
  private readonly timeoutMs: number;
  private readonly bindingAssertion: string;
  private pausedUntil = 0;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: BrokerModelOptions) {
    try {
      this.base = new URL(options.baseUrl);
      this.bindingAssertion = encodeInferenceBinding(options.expectedBinding);
    } catch {
      throw new BrokerModelError('invalid_configuration');
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname);
    const privateHttp = options.allowPrivateHttp && privateHttpHost(this.base.hostname);
    this.timeoutMs = options.timeoutMs ?? 40000;
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== '/' ||
      (this.base.protocol !== 'https:' &&
        !(this.base.protocol === 'http:' && (loopback || privateHttp))) ||
      !/^[^\s\x00-\x1f\x7f]{32,512}$/.test(options.token) ||
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1000 ||
      this.timeoutMs > 60000
    )
      throw new BrokerModelError('invalid_configuration');
    if (options.caCertificate && this.base.protocol !== 'https:')
      throw new BrokerModelError('invalid_configuration');
    this.fetcher =
      options.fetcher ?? (options.caCertificate ? pinnedHttpsFetch(options.caCertificate) : fetch);
  }
  isAvailable() {
    return (this.options.now ?? Date.now)() >= this.pausedUntil;
  }
  /** Explicit owner recovery may recheck a repaired service; it cannot reset server allowances. */
  resetAvailability() {
    this.pausedUntil = 0;
  }
  private async readExpression(
    response: Response,
    form: 'wish' | 'work',
    onDelta?: (text: string) => void,
  ) {
    // A file arrives whole in one frame; a wish may arrive as a short stream.
    const lineLimit = form === 'work' ? 120000 : 4000;
    const byteLimit = form === 'work' ? 160000 : 64000;
    if (response.headers.get('content-type')?.split(';')[0] !== 'application/x-ndjson')
      throw new BrokerModelError('invalid_response');
    const reader = response.body?.getReader();
    if (!reader) throw new BrokerModelError('empty_response');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '',
      text = '',
      bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        bytes += value?.byteLength ?? 0;
        if (bytes > byteLimit) throw new BrokerModelError('response_too_large');
        buffer += decoder.decode(value, { stream: !done });
        for (;;) {
          const boundary = buffer.indexOf('\n');
          if (boundary < 0) break;
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          if (!line || line.length > lineLimit) throw new BrokerModelError('invalid_response');
          let json: unknown;
          try {
            json = JSON.parse(line);
          } catch {
            throw new BrokerModelError('invalid_response');
          }
          const parsed = BrokerExpressionFrameSchema.safeParse(json);
          if (!parsed.success) throw new BrokerModelError('invalid_response');
          const frame = parsed.data;
          if (frame.type === 'delta') {
            if (text.length + frame.text.length > 360)
              throw new BrokerModelError('response_too_large');
            text += frame.text;
            onDelta?.(frame.text);
            continue;
          }
          if (frame.usage)
            this.options.onUsage?.(frame.usage.inputTokens, frame.usage.outputTokens);
          this.options.onUsageDetails?.(frame.usage);
          if (frame.type === 'error') {
            if (frame.error !== 'invalid_expression')
              this.pausedUntil = ['unauthorized', 'not_authorized'].includes(frame.error)
                ? Number.POSITIVE_INFINITY
                : (this.options.now ?? Date.now)() + (frame.retryAfterMs ?? 60000);
            throw new BrokerModelError(frame.error);
          }
          const completed = validatePublicExpression(frame.value, form);
          if (text && validatePublicExpression(text, form) !== completed)
            throw new BrokerModelError('invalid_response');
          return completed;
        }
        if (buffer.length > lineLimit) throw new BrokerModelError('response_too_large');
        if (done) throw new BrokerModelError('stream_interrupted');
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  private async request(
    workload: InferenceWorkload,
    body: unknown,
    onDelta?: (text: string) => void,
    form: 'wish' | 'work' = 'wish',
  ): Promise<unknown> {
    if (!this.isAvailable()) throw new BrokerModelError('paused');
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded) > 96000) throw new BrokerModelError('context_too_large');
    try {
      const response = await this.fetcher(new URL(`/v1/${workload}`, this.base), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'x-elsewhere-inference-binding': this.bindingAssertion,
          'content-type': 'application/json',
        },
        body: encoded,
      });
      if (workload === 'expression' && response.ok)
        return await this.readExpression(response, form, onDelta);
      const reader = response.body?.getReader();
      if (!reader) throw new BrokerModelError('empty_response');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let payload: unknown;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 64000) throw new BrokerModelError('response_too_large');
          chunks.push(value);
        }
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new BrokerModelError('invalid_response');
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!response.ok) {
        const error = BrokerErrorSchema.safeParse(payload);
        const reported = error.success ? error.data.usage : undefined;
        if (reported) this.options.onUsage?.(reported.inputTokens, reported.outputTokens);
        this.options.onUsageDetails?.(reported);
        const now = (this.options.now ?? Date.now)();
        if (
          !(
            error.success &&
            ((workload === 'expression' && error.data.error === 'invalid_expression') ||
              (workload === 'decision' && error.data.error === 'invalid_action'))
          )
        )
          this.pausedUntil = [401, 403].includes(response.status)
            ? Number.POSITIVE_INFINITY
            : now + (error.success ? (error.data.retryAfterMs ?? 60000) : 60000);
        throw new BrokerModelError(
          error.success ? error.data.error : 'request_failed',
          response.status,
          error.success ? error.data.diagnostic : undefined,
        );
      }
      const result = BrokerResponseSchema.safeParse(payload);
      if (!result.success) throw new BrokerModelError('invalid_response');
      if (result.data.usage)
        this.options.onUsage?.(result.data.usage.inputTokens, result.data.usage.outputTokens);
      this.options.onUsageDetails?.(result.data.usage);
      return result.data.value;
    } catch (error) {
      if (error instanceof BrokerModelError) throw error;
      this.pausedUntil = (this.options.now ?? Date.now)() + 60000;
      throw new BrokerModelError('network_unavailable');
    }
  }
  async decision(context: DecisionContext) {
    return this.request(
      'decision',
      BrokerDecisionRequestSchema.parse({ context: decisionWireContext(context) }),
    );
  }
  async reflection(input: ReflectionInput) {
    const { identity: _identity, ...data } = input;
    const parsed = BrokerReflectionRequestSchema.safeParse({ input: data });
    if (!parsed.success) throw new BrokerModelError('invalid_context');
    return this.request('reflection', parsed.data);
  }
  async expression(input: PublicExpressionInput, onDelta?: (text: string) => void) {
    const parsed = BrokerExpressionRequestSchema.safeParse({ input });
    if (!parsed.success) throw new BrokerModelError('invalid_context');
    return validatePublicExpression(
      await this.request('expression', parsed.data, onDelta, parsed.data.input.form),
      parsed.data.input.form,
    );
  }
}

export class BrokerDecisionProvider implements DecisionProvider<CharacterDecision> {
  readonly id = 'broker';
  constructor(readonly client: BrokerModelClient) {}
  isAvailable() {
    return this.client.isAvailable();
  }
  resetAvailability() {
    this.client.resetAvailability();
  }
  async propose(context: DecisionContext) {
    let value;
    try {
      value = await this.client.decision(context);
    } catch (error) {
      if (error instanceof BrokerModelError && error.code === 'invalid_action')
        throw new InvalidDecisionError(
          error.diagnostic?.code === 'invalid_json' ? 'invalid_json' : 'invalid_action',
          error.diagnostic?.fields ?? [],
        );
      throw error;
    }
    const result = CharacterDecisionSchema.safeParse(value);
    if (!result.success)
      throw new InvalidDecisionError('invalid_action', invalidDecisionFields(result.error));
    return result.data;
  }
}
export class BrokerReflectionProvider implements ReflectionProvider {
  readonly id = 'broker';
  constructor(readonly client: BrokerModelClient) {}
  isAvailable() {
    return this.client.isAvailable();
  }
  resetAvailability() {
    this.client.resetAvailability();
  }
  async reflect(input: ReflectionInput) {
    const value = await this.client.reflection(input);
    try {
      return validateReflectionProposal(value, input);
    } catch {
      throw new BrokerModelError('invalid_reflection');
    }
  }
}
export class BrokerExpressionProvider implements ExpressionProvider {
  readonly id = 'broker';
  constructor(readonly client: BrokerModelClient) {}
  isAvailable() {
    return this.client.isAvailable();
  }
  resetAvailability() {
    this.client.resetAvailability();
  }
  express(input: PublicExpressionInput, onDelta?: (text: string) => void) {
    return this.client.expression(input, onDelta);
  }
}
