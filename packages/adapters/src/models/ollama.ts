import { narrowActionFormat, type CharacterDecision } from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';
import {
  decisionMessages,
  parseModelDecision,
  readModelPayload,
  reportedUsage,
  usageCount,
} from './shared';
import type { ModelUsage } from '../../../models/src/contracts';

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  onUsage?: (input: number, output: number) => void;
  onUsageDetails?: (usage: ModelUsage | undefined) => void;
  maxOutputTokens?: number;
  contextTokens?: number;
  signal?: AbortSignal;
  messages?: ReturnType<typeof decisionMessages>;
}

/** Native local Ollama, with constrained output and thinking disabled for the small test model. */
export class OllamaDecisionProvider implements DecisionProvider<CharacterDecision> {
  readonly id = 'ollama';
  readonly model: string;
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: OllamaOptions = {}) {
    this.base = new URL(options.baseUrl ?? 'http://127.0.0.1:11434');
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname) ||
      !['http:', 'https:'].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    )
      throw new Error(
        'The local Ollama adapter accepts only loopback URLs without embedded credentials.',
      );
    this.model = options.model ?? 'qwen3:4b';
    this.fetcher = options.fetcher ?? fetch;
  }
  async health(): Promise<{ available: boolean; model: string; models: string[] }> {
    const response = await this.fetcher(new URL('/api/tags', this.base), {
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    const data = await readModelPayload(response);
    const models = Array.isArray(data.models)
      ? data.models.flatMap((model) =>
          model && typeof model === 'object' && typeof model.name === 'string' ? [model.name] : [],
        )
      : [];
    return { available: models.includes(this.model), model: this.model, models };
  }
  async propose(context: DecisionContext): Promise<CharacterDecision> {
    const response = await this.fetcher(new URL('/api/chat', this.base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any([
        AbortSignal.timeout(this.options.timeoutMs ?? 30000),
        ...(this.options.signal ? [this.options.signal] : []),
      ]),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        keep_alive: '5m',
        format: {
          type: 'object',
          properties: {
            action: narrowActionFormat(context.choices),
            why: { type: 'string', maxLength: 200 },
          },
          required: ['action', 'why'],
        },
        options: {
          temperature: 0.4,
          num_ctx: this.options.contextTokens ?? 8192,
          num_predict: this.options.maxOutputTokens ?? 500,
        },
        messages: this.options.messages ?? decisionMessages(context),
      }),
    });
    const payload = (await readModelPayload(response)) as {
      message?: { content?: unknown };
      prompt_eval_count?: unknown;
      eval_count?: unknown;
    };
    this.options.onUsage?.(usageCount(payload.prompt_eval_count), usageCount(payload.eval_count));
    this.options.onUsageDetails?.(reportedUsage(payload.prompt_eval_count, payload.eval_count));
    return parseModelDecision(payload.message?.content);
  }
}
