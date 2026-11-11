import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInferenceBroker,
  encodeInferenceBinding,
  InferenceDispatchError,
  type InferenceBrokerOptions,
  type InferenceBrokerState,
} from '../packages/inference/src/index';
import { createSoleHubertRegistry } from '../packages/identity/src/index';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import {
  BrokerExpressionProvider,
  BrokerModelClient,
} from '../packages/adapters/src/models/broker';
import { readChatGPTStream } from '../packages/adapters/src/models/chatgpt';
import {
  expressionMessages,
  PublicExpressionInputSchema,
  type PublicExpressionInput,
} from '../packages/adapters/src/models/expression';

const token = 'expression-private-fixture-token-'.repeat(2);
const binding = {
  worldId: 'elsewhere',
  ownerUserId: 'expression-owner',
  characterId: 'hubert',
  connectionId: 'expression-plan',
};
const input: PublicExpressionInput = {
  form: 'work',
  path: 'notes/chimes.md',
  title: 'The chimes',
  about: 'What the five copper tubes sound like when struck in turn.',
  siteUrl: 'https://studio.invalid/',
  material: {
    notes: ['The shortest tube starts first.'],
    readings: ['Tried strike 2 on the chime. It rang low.'],
    openQuestions: ['Why do the tubes ring differently?'],
  },
  shelf: [],
};
const usage = { inputTokens: 121, outputTokens: 18, cachedInputTokens: 50 };
const brokers = new Set<Awaited<ReturnType<typeof createInferenceBroker>>>();
afterEach(async () => {
  for (const broker of brokers) await broker.close();
  brokers.clear();
});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function memoryStore(): SnapshotStore<InferenceBrokerState> {
  let saved: StoredSnapshot<InferenceBrokerState> | null = null;
  return {
    load: async () => structuredClone(saved),
    save: async (value, version) => {
      if (version !== (saved?.version ?? 0)) throw Error('Fixture conflict.');
      saved = { value: structuredClone(value), version: version + 1 };
      return saved.version;
    },
    close: async () => undefined,
  };
}
async function start(overrides: Partial<InferenceBrokerOptions> = {}) {
  const store = overrides.store ?? memoryStore();
  const broker = await createInferenceBroker({
    token,
    binding,
    registry: createSoleHubertRegistry({
      ownerUserId: binding.ownerUserId,
      connectionId: binding.connectionId,
      provider: 'chatgpt',
    }),
    identity: 'Hubert is an odd, curious nonhuman creature.',
    store,
    now: () => Date.UTC(2026, 10, 9, 12),
    decision: async () => ({ value: { action: { type: 'rest' }, why: '' }, usage }),
    reflection: async () => ({ value: 'A private portrait.', usage }),
    ...overrides,
  });
  brokers.add(broker);
  await new Promise<void>((resolve, reject) => {
    broker.server.once('error', reject);
    broker.server.listen(0, '127.0.0.1', resolve);
  });
  const address = broker.server.address();
  if (!address || typeof address === 'string') throw Error('Fixture listener missing.');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
    fetch(baseUrl + '/v1/expression', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-elsewhere-inference-binding': encodeInferenceBinding(binding),
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    });
  return { broker, store, baseUrl, request };
}

describe('a private stream for deliberately public expression', () => {
  it('rejects private fields, actor overrides and missing providers before reserving a call', async () => {
    const expression = vi.fn(async () => ({ value: 'A new thought.', usage }));
    const h = await start({ expression });
    for (const extra of ['memories', 'outsideMessages', 'dreams', 'wishes', 'identity']) {
      const response = await h.request({ input: { ...input, [extra]: 'PRIVATE-CANARY' } });
      expect(response.status).toBe(400);
    }
    expect((await h.request({ input, ownerUserId: 'somebody-else' })).status).toBe(400);
    expect(
      (
        await h.request(
          { input },
          {
            'x-elsewhere-inference-binding': encodeInferenceBinding({
              ...binding,
              ownerUserId: 'somebody-else',
            }),
          },
        )
      ).status,
    ).toBe(403);
    expect(expression).not.toHaveBeenCalled();
    expect(h.broker.getState().allowance.calls).toBe(0);
    const absent = await start();
    expect((await absent.request({ input })).status).toBe(503);
    expect(absent.broker.getState().allowance.calls).toBe(0);
  });

  it('dispatches only after a durable reservation, then settles shared usage', async () => {
    const started = deferred();
    const finish = deferred();
    const text = '# The chimes\n\nThe shortest tube starts first.';
    const h = await start({
      expression: async (actual) => {
        expect(actual).toEqual(input);
        const durable = (await h.store.load())!.value;
        expect(durable.allowance.calls).toBe(1);
        expect(durable.accounting?.pending).toBeTruthy();
        started.resolve();
        await finish.promise;
        return { value: text, usage };
      },
    });
    const onUsage = vi.fn();
    const onUsageDetails = vi.fn();
    const client = new BrokerModelClient({
      baseUrl: h.baseUrl,
      token,
      expectedBinding: binding,
      onUsage,
      onUsageDetails,
    });
    const response = new BrokerExpressionProvider(client).express(input);
    try {
      await started.promise;
      expect(onUsage).not.toHaveBeenCalled();
      expect((await h.request({ input })).status).toBe(409);
    } finally {
      finish.resolve();
    }
    expect(await response).toBe(text);
    expect(onUsage).toHaveBeenCalledWith(usage.inputTokens, usage.outputTokens);
    expect(onUsageDetails).toHaveBeenCalledWith(usage);
    expect(h.broker.getState()).toMatchObject({
      allowance: { calls: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    });
    expect(h.broker.getState().accounting?.pending).toBeUndefined();
  });

  it('preserves known usage when a provider fails', async () => {
    const h = await start({
      expression: async () => {
        throw new InferenceDispatchError(usage);
      },
    });
    const reported = vi.fn();
    const client = new BrokerModelClient({
      baseUrl: h.baseUrl,
      token,
      expectedBinding: binding,
      onUsageDetails: reported,
    });
    await expect(client.expression(input)).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(reported).toHaveBeenCalledWith(usage);
    expect(h.broker.getState().allowance).toMatchObject({
      calls: 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  });

  it('never publishes an empty file, and keeps the reported usage', async () => {
    const h = await start({ expression: async () => ({ value: '  ', usage }) });
    const reported = vi.fn();
    const client = new BrokerModelClient({
      baseUrl: h.baseUrl,
      token,
      expectedBinding: binding,
      onUsageDetails: reported,
    });
    await expect(client.expression(input)).rejects.toMatchObject({ code: 'invalid_expression' });
    expect(reported).toHaveBeenCalledWith(usage);
    expect(h.broker.getState().allowance.calls).toBe(1);
  });

  it('aborts a disconnected expression and retains the spent call and unknown-usage fence', async () => {
    const started = deferred();
    const aborted = deferred();
    const settled = deferred();
    const backing = memoryStore();
    const h = await start({
      store: {
        ...backing,
        save: async (state, version) => {
          const next = await backing.save(state, version);
          if (state.allowance.calls === 1 && !state.accounting?.pending) settled.resolve();
          return next;
        },
      },
      expression: async (_actual, signal) => {
        started.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted.resolve();
              reject(new InferenceDispatchError());
            },
            { once: true },
          );
        });
      },
    });
    const controller = new AbortController();
    const response = h.request({ input }, {}, controller.signal).catch(() => undefined);
    await started.promise;
    controller.abort();
    await response;
    await aborted.promise;
    await settled.promise;
    expect(h.broker.getState().allowance.calls).toBe(1);
    expect(h.broker.getState().accounting?.unknownCalls).toBe(1);
  });

  it('requires a bounded terminal frame and never treats a private event as a public delta', async () => {
    const fixtures = [
      [{ type: 'delta', text: 'A partial thought.' }],
      [{ type: 'reasoning', text: 'PRIVATE-REASONING-CANARY' }],
      [{ type: 'delta', text: 'x'.repeat(361) }],
    ];
    for (const frames of fixtures) {
      const delta = vi.fn();
      const client = new BrokerModelClient({
        baseUrl: 'http://127.0.0.1:1',
        token,
        expectedBinding: binding,
        fetcher: async () =>
          new Response(frames.map((frame) => JSON.stringify(frame) + '\n').join(''), {
            headers: { 'content-type': 'application/x-ndjson' },
          }),
      });
      await expect(client.expression(input, delta)).rejects.toBeTruthy();
      expect(JSON.stringify(delta.mock.calls)).not.toContain('PRIVATE-REASONING-CANARY');
    }
  });
});

it('forwards only Responses output_text deltas and ignores reasoning, refusal and tool events', async () => {
  const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  const events = [
    { type: 'response.reasoning_text.delta', delta: 'PRIVATE-REASONING-CANARY' },
    { type: 'response.reasoning_summary_text.delta', delta: 'PRIVATE-SUMMARY-CANARY' },
    { type: 'response.refusal.delta', delta: 'PRIVATE-REFUSAL-CANARY' },
    { type: 'response.function_call_arguments.delta', delta: 'PRIVATE-TOOL-CANARY' },
    { type: 'response.output_text.delta', delta: 'Five tubes, ' },
    { type: 'response.output_text.delta', delta: 'one uneven chord.' },
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [
          { type: 'reasoning', summary: [{ text: 'PRIVATE-TERMINAL-CANARY' }] },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Five tubes, one uneven chord.' }],
          },
        ],
        usage: {
          input_tokens: 121,
          output_tokens: 18,
          input_tokens_details: { cached_tokens: 50 },
        },
      },
    },
  ];
  const delta = vi.fn();
  const reported = vi.fn();
  expect(await readChatGPTStream(new Response(events.map(frame).join('')), reported, delta)).toBe(
    'Five tubes, one uneven chord.',
  );
  expect(delta.mock.calls.flat().join('')).toBe('Five tubes, one uneven chord.');
  expect(reported).toHaveBeenCalledWith(usage);
  expect(JSON.stringify(expressionMessages('Hubert', input))).not.toContain('PRIVATE-');
});

describe('the file form of public expression', () => {
  it('accepts only the work form, with nothing private in its data', () => {
    expect(PublicExpressionInputSchema.safeParse(input).success).toBe(true);
    for (const form of ['catalog', 'wish', 'thought'])
      expect(PublicExpressionInputSchema.safeParse({ ...input, form }).success).toBe(false);
    const { form: _form, ...noForm } = input;
    expect(PublicExpressionInputSchema.safeParse(noForm).success).toBe(false);
    const [system, user] = expressionMessages('Hubert.', input);
    expect(user.content).not.toContain('"form"');
    expect(user.content).toContain('copper tubes');
    expect(system.content).toMatch(/^Hubert\.\n/);
    expect(system.content).toContain('one file for your own public site');
    expect(system.content).not.toContain('wish');
  });
});
