import { ChatGPTError } from '../../../security/src/chatgpt-store';

type Envelope = Record<string, unknown>;
type Phase = 'commentary' | 'final_answer';
type Output = {
  id: string;
  phase?: Phase;
  parts: Map<number, string>;
  emitted: string;
  seen: boolean;
};
const object = (value: unknown): Envelope | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Envelope) : undefined;
function phase(value: unknown): Phase | undefined {
  if (value === undefined || value === null) return;
  if (value === 'commentary' || value === 'final_answer') return value;
  throw new ChatGPTError('invalid_stream_event');
}
function index(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= 64)
    throw new ChatGPTError('invalid_stream_event');
  return value as number;
}
/** Bytes of answer text accepted by default; a longer answer is asked for explicitly. */
export const DEFAULT_OUTPUT_BYTES = 16000;
function text(message: Envelope, limit: number): string {
  if (message.role !== 'assistant' || !Array.isArray(message.content))
    throw new ChatGPTError('invalid_completed_response');
  const result = message.content
    .map((value) => {
      const part = object(value);
      if (part?.type !== 'output_text' || typeof part.text !== 'string')
        throw new ChatGPTError('invalid_completed_output');
      return part.text;
    })
    .join('');
  if (Buffer.byteLength(result) > limit) throw new ChatGPTError('output_too_large');
  return result;
}
const partsText = (output: Output) =>
  [...output.parts]
    .sort(([a], [b]) => a - b)
    .map(([, value]) => value)
    .join('');

/** One final answer is the application result. Commentary and reasoning are separate
 * items, not prefixes of that result, even when both contain output_text. */
export class ResponseTextChannels {
  private readonly outputs = new Map<number, Output>();
  private legacy = '';
  private legacySeen = false;
  private bytes = 0;
  constructor(
    private readonly onDelta?: (value: string) => void,
    private readonly limit = DEFAULT_OUTPUT_BYTES,
  ) {}

  private output(at: number, id: unknown) {
    if (typeof id !== 'string' || !id || id.length > 200)
      throw new ChatGPTError('invalid_stream_event');
    const previous = this.outputs.get(at);
    if (previous && previous.id !== id) throw new ChatGPTError('invalid_stream_event');
    if ([...this.outputs].some(([other, item]) => other !== at && item.id === id))
      throw new ChatGPTError('invalid_stream_event');
    const result: Output = previous ?? { id, parts: new Map(), emitted: '', seen: false };
    this.outputs.set(at, result);
    return result;
  }
  private emit(output: Output, value: string) {
    if (!this.onDelta || output.phase !== 'final_answer') return;
    if (!value.startsWith(output.emitted)) throw new ChatGPTError('invalid_completed_output');
    const next = value.slice(output.emitted.length);
    if (next) this.onDelta(next);
    output.emitted = value;
  }
  accept(event: Envelope) {
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
      const item = object(event.item);
      if (item?.type !== 'message') return;
      if (item.role !== 'assistant') throw new ChatGPTError('invalid_stream_event');
      const output = this.output(index(event.output_index), item.id);
      const nextPhase = phase(item.phase);
      if (output.phase && nextPhase && output.phase !== nextPhase)
        throw new ChatGPTError('invalid_stream_event');
      output.phase ??= nextPhase;
      output.seen = true;
      if (event.type === 'response.output_item.done') {
        const final = text(item, this.limit);
        if (output.parts.size && partsText(output) !== final)
          throw new ChatGPTError('invalid_completed_output');
        this.emit(output, final);
      } else this.emit(output, output.parts.get(0) ?? '');
    }
    if (event.type !== 'response.output_text.delta') return;
    if (typeof event.delta !== 'string') throw new ChatGPTError('invalid_stream_event');
    if (!event.delta) return;
    this.bytes += Buffer.byteLength(event.delta);
    if (this.bytes > this.limit) throw new ChatGPTError('output_too_large');
    if (event.output_index === undefined && event.item_id === undefined) {
      this.legacySeen = true;
      this.legacy += event.delta;
      return; // Unphased legacy text is held until one completed message establishes its result.
    }
    const output = this.output(index(event.output_index), event.item_id);
    const part = event.content_index === undefined ? 0 : index(event.content_index);
    output.parts.set(part, (output.parts.get(part) ?? '') + event.delta);
    // Later content parts stay buffered until item completion so interleaved parts cannot reorder text.
    if (output.seen) this.emit(output, output.parts.get(0) ?? '');
  }
  complete(value: unknown): string {
    if (!Array.isArray(value) || value.length > 64)
      throw new ChatGPTError('invalid_completed_response');
    if (value.some((item) => !['message', 'reasoning'].includes(String(object(item)?.type))))
      throw new ChatGPTError('unexpected_output_capability');
    const messages = value.flatMap((entry, at) => {
      const item = object(entry)!;
      if (item.type !== 'message') return [];
      const output = this.outputs.get(at);
      const nextPhase = phase(item.phase);
      if (
        output &&
        (output.id !== item.id || (output.phase && nextPhase && output.phase !== nextPhase))
      )
        throw new ChatGPTError('invalid_completed_output');
      return [{ at, item, output, phase: nextPhase ?? output?.phase }];
    });
    for (const [at, output] of this.outputs) {
      const item = object(value[at]);
      if (!item || item.type !== 'message' || item.id !== output.id)
        throw new ChatGPTError('invalid_completed_output');
      if (output.parts.size && partsText(output) !== text(item, this.limit))
        throw new ChatGPTError('invalid_completed_output');
    }
    const finals = messages.filter((item) => item.phase === 'final_answer');
    const selected =
      finals.length === 1
        ? finals[0]
        : finals.length === 0 && messages.length === 1 && !messages[0].phase
          ? messages[0]
          : undefined;
    if (!selected) throw new ChatGPTError('invalid_completed_output');
    const result = text(selected.item, this.limit);
    if (!result && !this.onDelta) throw new ChatGPTError('invalid_completed_output');
    if (this.legacySeen && (this.outputs.size || messages.length !== 1 || this.legacy !== result))
      throw new ChatGPTError('invalid_completed_output');
    const emitted = selected.output?.emitted ?? '';
    if (!result.startsWith(emitted)) throw new ChatGPTError('invalid_completed_output');
    const rest = result.slice(emitted.length);
    if (rest) this.onDelta?.(rest);
    return result;
  }
}
