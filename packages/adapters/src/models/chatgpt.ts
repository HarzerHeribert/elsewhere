import type { CharacterCommand } from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';
import { ChatGPTError } from '../../../security/src/chatgpt-store';
import { boundedChatGPTJson, chatGPTFailure, ChatGPTSession } from '../../../security/src/chatgpt';
import { decisionMessages, parseModelAction, reportedUsage } from './shared';
import {
  reflectionMessages,
  validateReflectionProposal,
  type ReflectionInput,
  type ReflectionProvider,
} from './reflection';
import type { ModelUsage } from '../../../models/src/contracts';
import {
  expressionMessages,
  validatePublicExpression,
  type ExpressionProvider,
  type PublicExpressionInput,
} from './expression';

interface ChatGPTOptions {
  model?: string;
  timeoutMs?: number;
  onUsage?: (input: number, output: number) => void;
  onUsageDetails?: (usage: ModelUsage | undefined) => void;
}
type Envelope = Record<string, unknown>;
function envelope(value: unknown): Envelope | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Envelope)
    : undefined;
}

/** Bounded HTTP/SSE. Deltas alone never authorize a character action. */
export async function readChatGPTStream(
  response: Response,
  usage: (value: ModelUsage | undefined) => void,
  onDelta?: (text: string) => void,
): Promise<string> {
  if (!response.ok) {
    const payload = await boundedChatGPTJson(response);
    throw chatGPTFailure(
      payload,
      response.status,
      response.headers.get('x-request-id') ?? undefined,
    );
  }
  // Some HTTP transports omit Content-Type. The bounded SSE grammar and explicit
  // completed response below remain mandatory, regardless of that header.
  const contentType = response.headers.get('content-type') ?? 'missing';
  const reader = response.body?.getReader();
  if (!reader) throw new ChatGPTError('empty_response');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '',
    deltaText = '',
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 512000) throw new ChatGPTError('stream_too_large');
      buffer += decoder.decode(value, { stream: !done });
      // SSE supports CRLF, LF and CR; preserve a trailing CR across network chunks.
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n');
      if (done) buffer = buffer.replace(/\r/g, '\n');
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data || data === '[DONE]') continue;
        if (data.length > 128000) throw new ChatGPTError('event_too_large');
        let event: Envelope | undefined;
        try {
          event = envelope(JSON.parse(data));
        } catch {
          throw new ChatGPTError('invalid_stream_event');
        }
        if (!event) throw new ChatGPTError('invalid_stream_event');
        if (event.type === 'response.output_text.delta') {
          if (typeof event.delta !== 'string') throw new ChatGPTError('invalid_stream_event');
          deltaText += event.delta;
          if (Buffer.byteLength(deltaText) > 16000) throw new ChatGPTError('output_too_large');
          if (event.delta) onDelta?.(event.delta);
        }
        if (
          event.type === 'response.completed' ||
          event.type === 'response.failed' ||
          event.type === 'response.incomplete'
        ) {
          const terminal = envelope(event.response);
          const counts = envelope(terminal?.usage);
          usage(
            reportedUsage(
              counts?.input_tokens,
              counts?.output_tokens,
              envelope(counts?.input_tokens_details)?.cached_tokens ?? 0,
            ),
          );
          if (event.type === 'response.failed')
            throw chatGPTFailure(
              terminal,
              undefined,
              response.headers.get('x-request-id') ?? undefined,
            );
          if (event.type === 'response.incomplete') throw new ChatGPTError('response_incomplete');
          if (!terminal || terminal.status !== 'completed' || !Array.isArray(terminal.output))
            throw new ChatGPTError('invalid_completed_response');
          if (
            terminal.output.some(
              (item) => !['message', 'reasoning'].includes(String(envelope(item)?.type)),
            )
          )
            throw new ChatGPTError('unexpected_output_capability');
          const text = terminal.output
            .flatMap((item) => {
              const message = envelope(item);
              if (
                message?.type !== 'message' ||
                message.role !== 'assistant' ||
                !Array.isArray(message.content)
              )
                return [];
              return message.content.flatMap((item) => {
                const part = envelope(item);
                return part?.type === 'output_text' && typeof part.text === 'string'
                  ? [part.text]
                  : [];
              });
            })
            .join('');
          if (
            (!text && !onDelta) ||
            Buffer.byteLength(text) > 16000 ||
            (deltaText && text !== deltaText)
          )
            throw new ChatGPTError('invalid_completed_output');
          return text;
        }
        if (event.type === 'error')
          throw chatGPTFailure(
            { error: event },
            undefined,
            response.headers.get('x-request-id') ?? undefined,
          );
      }
      if (buffer.length > 128000) throw new ChatGPTError('event_too_large');
      if (done) {
        const error = new ChatGPTError('stream_interrupted');
        error.diagnostics = { contentType, keys: [] };
        throw error;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Subscription quota only. Fixed public endpoint, no Codex harness, retries or billing fallback. */
export class ChatGPTClient {
  readonly model: string;
  private catalog?: string[];
  constructor(
    readonly session: ChatGPTSession,
    private readonly options: ChatGPTOptions = {},
  ) {
    this.model = options.model ?? 'gpt-6-luna';
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(this.model)) throw new ChatGPTError('invalid_model');
  }
  isAvailable() {
    return this.session.isAvailable();
  }
  async models(): Promise<Array<{ slug: string; displayName: string }>> {
    const token = await this.session.accessToken();
    const response = await this.session.fetcher('https://api.openai.com/v1/models', {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = envelope(await boundedChatGPTJson(response, 4 * 1024 * 1024));
    if (!response.ok)
      throw chatGPTFailure(
        payload,
        response.status,
        response.headers.get('x-request-id') ?? undefined,
      );
    if (!Array.isArray(payload?.models)) throw new ChatGPTError('invalid_model_catalog');
    const models = payload.models.flatMap((value) => {
      const item = envelope(value);
      return item?.visibility === 'list' &&
        typeof item.slug === 'string' &&
        /^[a-zA-Z0-9._-]{1,120}$/.test(item.slug) &&
        typeof item.display_name === 'string'
        ? [{ slug: item.slug, displayName: item.display_name.slice(0, 200) }]
        : [];
    });
    this.catalog = models.map((model) => model.slug);
    return models;
  }
  async text(
    messages: ReturnType<typeof decisionMessages>,
    signal?: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<string> {
    try {
      if (!this.catalog) await this.models();
      if (!this.catalog!.includes(this.model))
        throw new ChatGPTError('selected_model_unavailable', 400);
      const token = await this.session.accessToken();
      const response = await this.session.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(this.options.timeoutMs ?? 30000),
          ...(signal ? [signal] : []),
        ]),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: this.model,
          instructions: messages[0].content,
          input: [{ role: 'user', content: messages[1].content }],
          store: false,
          stream: true,
          ...(this.model === 'gpt-6-luna' ? { reasoning: { effort: 'none' } } : {}),
        }),
      });
      return await readChatGPTStream(
        response,
        (usage) => {
          if (usage) this.options.onUsage?.(usage.inputTokens, usage.outputTokens);
          this.options.onUsageDetails?.(usage);
        },
        onDelta,
      );
    } catch (error) {
      const failure =
        error instanceof ChatGPTError ? error : new ChatGPTError('network_or_stream_unavailable');
      // A quota/policy failure stops future autonomous requests until an operator resumes.
      // Network and malformed-stream failures receive a persisted five-minute cooldown.
      await this.session.pauseFor(failure);
      throw failure;
    }
  }
}

export class ChatGPTDecisionProvider implements DecisionProvider<CharacterCommand> {
  readonly id = 'chatgpt';
  constructor(readonly client: ChatGPTClient) {}
  isAvailable() {
    return this.client.isAvailable();
  }
  async propose(context: DecisionContext) {
    return parseModelAction(await this.client.text(decisionMessages(context)));
  }
}
export class ChatGPTReflectionProvider implements ReflectionProvider {
  readonly id = 'chatgpt';
  constructor(readonly client: ChatGPTClient) {}
  isAvailable() {
    return this.client.isAvailable();
  }
  async reflect(input: ReflectionInput) {
    const text = await this.client.text(reflectionMessages(input));
    return validateReflectionProposal(
      JSON.parse(
        text
          .trim()
          .replace(/^```(?:json)?\s*/, '')
          .replace(/\s*```$/, ''),
      ),
      input,
    );
  }
}

export class ChatGPTExpressionProvider implements ExpressionProvider {
  readonly id = 'chatgpt';
  constructor(
    readonly client: ChatGPTClient,
    readonly identity: string,
  ) {}
  isAvailable() {
    return this.client.isAvailable();
  }
  async express(input: PublicExpressionInput, onDelta?: (text: string) => void) {
    let length = 0;
    return validatePublicExpression(
      await this.client.text(expressionMessages(this.identity, input), undefined, (text) => {
        length += text.length;
        if (length > 360) return; // Consume the bounded terminal event so known usage is retained.
        onDelta?.(text);
      }),
    );
  }
}
