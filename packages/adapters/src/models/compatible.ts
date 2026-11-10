import type { CharacterDecision } from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';
import {
  decisionMessages,
  parseModelDecision,
  readModelPayload,
  reportedUsage,
  usageCount,
} from './shared';
import type { ModelUsage } from '../../../models/src/contracts';

export interface CompatibleModelOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  onUsageDetails?: (usage: ModelUsage | undefined) => void;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  promptCacheKey?: string;
  cloudflareGateway?: boolean;
  sessionAffinity?: string;
  messages?: ReturnType<typeof decisionMessages>;
  fetcher?: typeof fetch;
}

/** Optional server-side adapter for a chat-completions-compatible endpoint.
 * No credential discovery, arbitrary tools, retries or permission grants. */
export class CompatibleDecisionProvider implements DecisionProvider<CharacterDecision> {
  readonly id = 'compatible';
  private readonly endpoint: URL;
  constructor(private readonly options: CompatibleModelOptions) {
    const base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    if (base.username || base.password || base.search || base.hash)
      throw new Error('MODEL_BASE_URL cannot contain credentials, query parameters or a fragment.');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))
      throw new Error('Model endpoints must use HTTPS, except loopback development servers.');
    if (!options.model || !options.apiKey)
      throw new Error('Compatible mode requires MODEL_NAME and MODEL_API_KEY.');
    this.endpoint = new URL('chat/completions', base);
  }
  async propose(context: DecisionContext): Promise<CharacterDecision> {
    const response = await (this.options.fetcher ?? fetch)(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        ...(this.options.sessionAffinity
          ? { 'x-session-affinity': this.options.sessionAffinity }
          : {}),
        ...(this.options.cloudflareGateway || this.endpoint.hostname === 'gateway.ai.cloudflare.com'
          ? {
              'cf-aig-skip-cache': 'true',
              'cf-aig-max-attempts': '1',
              'cf-aig-collect-log': 'false',
            }
          : {}),
      },
      redirect: 'error',
      signal: AbortSignal.any([
        AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        ...(this.options.signal ? [this.options.signal] : []),
      ]),
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.5,
        max_tokens: this.options.maxOutputTokens ?? 600,
        ...(this.options.promptCacheKey ? { prompt_cache_key: this.options.promptCacheKey } : {}),
        messages: this.options.messages ?? decisionMessages(context),
      }),
    });
    const payload = (await readModelPayload(response)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        prompt_tokens_details?: { cached_tokens?: unknown };
      };
    };
    this.options.onUsage?.(
      usageCount(payload.usage?.prompt_tokens),
      usageCount(payload.usage?.completion_tokens),
    );
    this.options.onUsageDetails?.(
      reportedUsage(
        payload.usage?.prompt_tokens,
        payload.usage?.completion_tokens,
        payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      ),
    );
    return parseModelDecision(payload.choices?.[0]?.message?.content);
  }
}
