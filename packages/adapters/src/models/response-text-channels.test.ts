import { expect, it, vi } from 'vitest';
import { ResponseTextChannels } from './response-text-channels';

const message = (id: string, phase: string | undefined, text: string) => ({
  type: 'message',
  id,
  role: 'assistant',
  phase,
  content: [{ type: 'output_text', text }],
});
const added = (output_index: number, id: string, phase?: string) => ({
  type: 'response.output_item.added',
  output_index,
  item: message(id, phase, ''),
});
const delta = (output_index: number, item_id: string, text: string, content_index = 0) => ({
  type: 'response.output_text.delta',
  output_index,
  item_id,
  content_index,
  delta: text,
});

it('streams only explicitly final text and never commentary or reasoning', () => {
  const onDelta = vi.fn();
  const channels = new ResponseTextChannels(onDelta);
  channels.accept(added(0, 'msg_commentary', 'commentary'));
  channels.accept(delta(0, 'msg_commentary', 'COMMENTARY-CANARY'));
  channels.accept({ type: 'response.reasoning_text.delta', delta: 'REASONING-CANARY' });
  expect(onDelta).not.toHaveBeenCalled();
  channels.accept(added(2, 'msg_final', 'final_answer'));
  channels.accept(delta(2, 'msg_final', 'A tiny '));
  expect(onDelta).toHaveBeenCalledWith('A tiny '); // Still streams before terminal completion.
  channels.accept(delta(2, 'msg_final', 'observation.'));
  expect(
    channels.complete([
      message('msg_commentary', 'commentary', 'COMMENTARY-CANARY'),
      { type: 'reasoning', summary: [] },
      message('msg_final', 'final_answer', 'A tiny observation.'),
    ]),
  ).toBe('A tiny observation.');
  expect(onDelta.mock.calls).toEqual([['A tiny '], ['observation.']]);
});

it('holds unphased text until a single completed message establishes the legacy result', () => {
  const onDelta = vi.fn(),
    channels = new ResponseTextChannels(onDelta);
  channels.accept(added(0, 'msg_unphased'));
  channels.accept(delta(0, 'msg_unphased', 'A final note.'));
  expect(onDelta).not.toHaveBeenCalled();
  expect(channels.complete([message('msg_unphased', undefined, 'A final note.')])).toBe(
    'A final note.',
  );
  expect(onDelta.mock.calls).toEqual([['A final note.']]);
});

it('never emits buffered unphased text later identified as commentary', () => {
  const onDelta = vi.fn(),
    channels = new ResponseTextChannels(onDelta);
  channels.accept(added(0, 'msg_commentary'));
  channels.accept(delta(0, 'msg_commentary', 'PRIVATE-PREAMBLE'));
  channels.accept({
    type: 'response.output_item.done',
    output_index: 0,
    item: message('msg_commentary', 'commentary', 'PRIVATE-PREAMBLE'),
  });
  expect(onDelta).not.toHaveBeenCalled();
  expect(
    channels.complete([
      message('msg_commentary', 'commentary', 'PRIVATE-PREAMBLE'),
      message('msg_final', 'final_answer', 'Public note.'),
    ]),
  ).toBe('Public note.');
  expect(onDelta.mock.calls).toEqual([['Public note.']]);
});

it.each(
  [
    [
      message('first', undefined, '{"action":{"type":"rest"}}'),
      message('second', undefined, '{"action":{"type":"reflect"}}'),
    ],
    [
      message('first', 'final_answer', '{"action":{"type":"rest"}}'),
      message('second', 'final_answer', '{"action":{"type":"reflect"}}'),
    ],
    [message('only', 'commentary', '{"action":{"type":"reflect"}}')],
  ].map((output) => ({ output })),
)(
  'rejects ambiguous or missing final output instead of extracting any valid JSON',
  ({ output }) => {
    const onDelta = vi.fn();
    expect(() => new ResponseTextChannels(onDelta).complete(output)).toThrow(
      'invalid_completed_output',
    );
    expect(onDelta).not.toHaveBeenCalled();
  },
);

it('correlates item identifiers and rejects a delta for a different item at the same index', () => {
  const channels = new ResponseTextChannels();
  channels.accept(added(0, 'msg_expected', 'final_answer'));
  expect(() => channels.accept(delta(0, 'msg_other', 'x'))).toThrow('invalid_stream_event');
  expect(() => channels.accept(added(1, 'msg_expected', 'commentary'))).toThrow(
    'invalid_stream_event',
  );
});

it('rejects phase changes and terminal per-item mismatches', () => {
  const channels = new ResponseTextChannels();
  channels.accept(added(0, 'msg_final', 'final_answer'));
  channels.accept(delta(0, 'msg_final', 'Expected.'));
  expect(() => channels.complete([message('msg_final', 'final_answer', 'Different.')])).toThrow(
    'invalid_completed_output',
  );
  expect(() =>
    channels.accept({
      type: 'response.output_item.done',
      output_index: 0,
      item: message('msg_final', 'commentary', 'Expected.'),
    }),
  ).toThrow('invalid_stream_event');
});

it('assembles content parts in their declared order while retaining immediate first-part streaming', () => {
  const onDelta = vi.fn(),
    channels = new ResponseTextChannels(onDelta);
  channels.accept(added(0, 'msg_final', 'final_answer'));
  channels.accept(delta(0, 'msg_final', ' second', 1));
  expect(onDelta).not.toHaveBeenCalled();
  channels.accept(delta(0, 'msg_final', 'First', 0));
  expect(onDelta.mock.calls).toEqual([['First']]);
  const item = {
    ...message('msg_final', 'final_answer', ''),
    content: [
      { type: 'output_text', text: 'First' },
      { type: 'output_text', text: ' second' },
    ],
  };
  channels.accept({ type: 'response.output_item.done', output_index: 0, item });
  expect(channels.complete([item])).toBe('First second');
  expect(onDelta.mock.calls).toEqual([['First'], [' second']]);
});

it('accepts a terminal final item when item-added metadata was omitted, buffering until then', () => {
  const onDelta = vi.fn(),
    channels = new ResponseTextChannels(onDelta);
  channels.accept(delta(0, 'msg_final', 'Final.'));
  expect(onDelta).not.toHaveBeenCalled();
  expect(channels.complete([message('msg_final', 'final_answer', 'Final.')])).toBe('Final.');
  expect(onDelta.mock.calls).toEqual([['Final.']]);
});

it('does not mistake an empty keepalive delta for a partial text result', () => {
  const channels = new ResponseTextChannels();
  channels.accept(added(0, 'msg_final', 'final_answer'));
  channels.accept(delta(0, 'msg_final', ''));
  expect(channels.complete([message('msg_final', 'final_answer', 'Final.')])).toBe('Final.');
});

it('rejects uncorrelated legacy deltas in a multi-message response and ghost output indexes', () => {
  const legacy = new ResponseTextChannels();
  legacy.accept({ type: 'response.output_text.delta', delta: 'Final.' });
  expect(() =>
    legacy.complete([
      message('pre', 'commentary', 'Preamble.'),
      message('final', 'final_answer', 'Final.'),
    ]),
  ).toThrow('invalid_completed_output');
  const indexed = new ResponseTextChannels();
  indexed.accept(delta(2, 'msg_missing', 'Final.'));
  expect(() => indexed.complete([message('final', 'final_answer', 'Final.')])).toThrow(
    'invalid_completed_output',
  );
});
