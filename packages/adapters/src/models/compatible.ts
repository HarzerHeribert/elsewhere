import type { CharacterCommand } from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';
import { decisionMessages, parseModelAction, readModelPayload, usageCount } from './shared';

export interface CompatibleModelOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  fetcher?: typeof fetch;
}

/** Optional server-side adapter for a chat-completions-compatible endpoint.
 * No credential discovery, arbitrary tools, retries or permission grants. */
export class CompatibleDecisionProvider implements DecisionProvider<CharacterCommand> {
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
  async propose(context: DecisionContext): Promise<CharacterCommand> {
    const response = await (this.options.fetcher ?? fetch)(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.5,
        max_tokens: 300,
        messages: decisionMessages(context),
      }),
    });
    const payload = (await readModelPayload(response)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    this.options.onUsage?.(
      usageCount(payload.usage?.prompt_tokens),
      usageCount(payload.usage?.completion_tokens),
    );
    return parseModelAction(payload.choices?.[0]?.message?.content);
  }
}
