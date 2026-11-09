import type { CharacterCommand } from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';
import { CharacterCommandSchema } from '@elsewhere/character-interfaces';
import {
  BrokerDecisionRequestSchema,
  BrokerErrorSchema,
  BrokerReflectionRequestSchema,
  BrokerResponseSchema,
  decisionWireContext,
  encodeInferenceBinding,
  type InferenceBinding,
  type InferenceWorkload,
} from '../../../inference/src/contracts';
import type { ModelUsage } from '../../../models/src/contracts';
import {
  validateReflectionProposal,
  type ReflectionInput,
  type ReflectionProvider,
} from './reflection';

export interface BrokerModelOptions {
  baseUrl: string;
  token: string;
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
  }
  isAvailable() {
    return (this.options.now ?? Date.now)() >= this.pausedUntil;
  }
  private async request(workload: InferenceWorkload, body: unknown): Promise<unknown> {
    if (!this.isAvailable()) throw new BrokerModelError('paused');
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded) > 96000) throw new BrokerModelError('context_too_large');
    try {
      const response = await (this.options.fetcher ?? fetch)(
        new URL(`/v1/${workload}`, this.base),
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            authorization: `Bearer ${this.options.token}`,
            'x-elsewhere-inference-binding': this.bindingAssertion,
            'content-type': 'application/json',
          },
          body: encoded,
        },
      );
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
        this.pausedUntil = [401, 403].includes(response.status)
          ? Number.POSITIVE_INFINITY
          : now + (error.success ? (error.data.retryAfterMs ?? 60000) : 60000);
        throw new BrokerModelError(
          error.success ? error.data.error : 'request_failed',
          response.status,
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
}

export class BrokerDecisionProvider implements DecisionProvider<CharacterCommand> {
  readonly id = 'broker';
  constructor(readonly client: BrokerModelClient) {}
  isAvailable() {
    return this.client.isAvailable();
  }
  async propose(context: DecisionContext) {
    const result = CharacterCommandSchema.safeParse(await this.client.decision(context));
    if (!result.success) throw new BrokerModelError('invalid_action');
    return result.data;
  }
}
export class BrokerReflectionProvider implements ReflectionProvider {
  readonly id = 'broker';
  constructor(readonly client: BrokerModelClient) {}
  isAvailable() {
    return this.client.isAvailable();
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
