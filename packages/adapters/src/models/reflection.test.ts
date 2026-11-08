import { describe, expect, it, vi } from 'vitest';
import type { ModelBudgetPort } from '../../../models/src/contracts';
import { modelPolicy, modelProfile, routingConfig } from '../../../../tests/model-fixtures';
import {
  CompatibleReflectionProvider,
  OllamaReflectionProvider,
  REFLECTION_FORMAT,
  RoutedReflectionProvider,
  type ReflectionInput,
} from './reflection';
import { RoutedDecisionProvider } from './routed';

const input: ReflectionInput = {
  identity: 'You are a curious creature who enjoys birds.',
  episodes: [{ id: 'source-1', summary: 'A duck flew away. PRIVATE-SOURCE-CANARY' }],
  affordances: [{ id: 'watch-pond', description: 'Watch from the currently reachable pond edge.' }],
};
const proposal = {
  vignette: 'In an imagined pond, sparrows land on a teacup runway.',
  impulses: [{ affordanceId: 'watch-pond', reason: 'Quiet watching could offer new evidence.' }],
};

const transports = [
  {
    name: 'ollama',
    create: (fetcher: typeof fetch, onUsage: (input: number, output: number) => void = vi.fn()) =>
      new OllamaReflectionProvider({ fetcher, onUsage }),
    payload: (value: unknown) => ({
      message: { content: typeof value === 'string' ? value : JSON.stringify(value) },
      prompt_eval_count: 40,
      eval_count: 20,
    }),
  },
  {
    name: 'compatible',
    create: (fetcher: typeof fetch, onUsage: (input: number, output: number) => void = vi.fn()) =>
      new CompatibleReflectionProvider({
        baseUrl: 'https://example.invalid/v1',
        model: 'fixture',
        apiKey: 'PRIVATE-KEY-CANARY',
        fetcher,
        onUsage,
      }),
    payload: (value: unknown) => ({
      choices: [
        { message: { content: typeof value === 'string' ? value : JSON.stringify(value) } },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 20 },
    }),
  },
];

describe.each(transports)('$name private reflection boundary', (transport) => {
  it('generates bounded fictional JSON, keeping sources in data and credentials out of it', async () => {
    const onUsage = vi.fn();
    const fetcher = vi.fn(
      async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(JSON.stringify(transport.payload(proposal))),
    );
    expect(await transport.create(fetcher as typeof fetch, onUsage).reflect(input)).toEqual(
      proposal,
    );
    const init = fetcher.mock.calls[0][1];
    const body = String(init?.body);
    const sent = JSON.parse(body);
    expect(sent.messages[0].content).toContain(input.identity);
    expect(sent.messages[0].content).toContain('explicitly fictional');
    expect(sent.messages[0].content).toContain('Keep this output private');
    expect(sent.messages[0].content).toContain('You have no tools');
    expect(sent.messages[0].content).not.toContain('PRIVATE-SOURCE-CANARY');
    expect(JSON.parse(sent.messages[1].content)).toEqual({
      episodes: input.episodes,
      affordances: input.affordances,
    });
    expect(body).not.toContain('PRIVATE-KEY-CANARY');
    expect(sent).not.toHaveProperty('tools');
    expect(sent).not.toHaveProperty('tool_choice');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(onUsage).toHaveBeenCalledWith(40, 20);
    if (transport.name === 'ollama') {
      expect(sent.format).toEqual(REFLECTION_FORMAT);
      expect(sent.options.num_predict).toBe(500);
      expect(sent.think).toBe(false);
      expect(sent.stream).toBe(false);
      expect(init?.headers).not.toHaveProperty('authorization');
    } else {
      expect(sent.max_tokens).toBe(500);
      expect(init?.headers).toHaveProperty('authorization', 'Bearer PRIVATE-KEY-CANARY');
    }
  });

  it.each([
    { ...proposal, impulses: [{ affordanceId: 'invented-tool', reason: 'Do it.' }] },
    { ...proposal, impulses: [proposal.impulses[0], proposal.impulses[0]] },
    { ...proposal, impulses: [...proposal.impulses, ...proposal.impulses, ...proposal.impulses] },
    { ...proposal, vignette: 'x'.repeat(1201) },
    { ...proposal, vignette: ' ' },
    { ...proposal, impulses: [{ affordanceId: 'watch-pond', reason: 'x'.repeat(241) }] },
    { ...proposal, impulses: [{ affordanceId: 'watch-pond', reason: 'Watch.', action: 'move' }] },
    { ...proposal, memoryWeights: { 'source-1': 100 } },
    { type: 'rest', durationMs: 60_000 },
  ])(
    'rejects unauthorized or unbounded proposal fields and still records usage: %j',
    async (value) => {
      const onUsage = vi.fn();
      const fetcher = (async () =>
        new Response(JSON.stringify(transport.payload(value)))) as typeof fetch;
      await expect(transport.create(fetcher, onUsage).reflect(input)).rejects.toThrow();
      expect(onUsage).toHaveBeenCalledWith(40, 20);
    },
  );

  it('allows a vignette without any waking impulse', async () => {
    const value = { vignette: 'Imagined clouds fold themselves into paper birds.', impulses: [] };
    const fetcher = (async () =>
      new Response(
        JSON.stringify(transport.payload(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``)),
      )) as typeof fetch;
    expect(await transport.create(fetcher).reflect({ ...input, affordances: [] })).toEqual(value);
  });

  it('validates host input before any request and does not retry an offline call', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    const provider = transport.create(fetcher as typeof fetch);
    await expect(
      provider.reflect({ ...input, episodes: Array(25).fill(input.episodes[0]) }),
    ).rejects.toThrow();
    await expect(
      provider.reflect({ ...input, affordances: [...input.affordances, ...input.affordances] }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.reflect(input)).rejects.toThrow('offline');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('cancels oversized envelopes before parsing model text', async () => {
    const cancel = vi.fn();
    const fetcher = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('x'.repeat(64_001)));
          },
          cancel,
        }),
      )) as typeof fetch;
    await expect(transport.create(fetcher).reflect(input)).rejects.toThrow(/size/);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('reflection endpoint policy', () => {
  it('rejects remote Ollama and secrets or insecure transport in compatible URLs', () => {
    expect(
      () => new OllamaReflectionProvider({ baseUrl: 'https://ollama.example.invalid' }),
    ).toThrow();
    for (const baseUrl of [
      'http://example.invalid/v1',
      'https://secret@example.invalid/v1',
      'https://example.invalid/v1?key=secret',
    ])
      expect(
        () => new CompatibleReflectionProvider({ baseUrl, model: 'fixture', apiKey: 'fixture' }),
      ).toThrow();
  });
});

function budget(events: string[], allowed = true): ModelBudgetPort {
  let count = 0;
  return {
    reserve: vi.fn(async (estimate) => {
      events.push(`reserve:${estimate.workload}`);
      return allowed ? `reservation-${++count}` : null;
    }),
    settle: vi.fn(async (id, usage, failed) => {
      events.push(`settle:${id}:${failed}:${usage?.outputTokens ?? 'unknown'}`);
    }),
  };
}

describe('routed reflection allowance and privacy', () => {
  const config = () =>
    routingConfig({ policies: { decision: modelPolicy(), reflection: modelPolicy() } });

  it('shares waking reservations, charges each fresh dream and never replays dream output', async () => {
    const events: string[] = [];
    const sharedBudget = budget(events);
    let dreams = 0;
    const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      const isReflection = sent.messages[0].content.includes('explicitly fictional');
      events.push(isReflection ? 'fetch:reflection' : 'fetch:decision');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  isReflection
                    ? { ...proposal, vignette: `Imagined bird ${++dreams}.` }
                    : { type: 'reflect' },
                ),
              },
            },
          ],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 30 },
          },
        }),
      );
    });
    const options = { fetcher: fetcher as typeof fetch };
    const environment = { MODEL_FIXTURE_KEY: 'PRIVATE-KEY-CANARY' };
    const waking = new RoutedDecisionProvider(config(), sharedBudget, environment, options);
    const resting = new RoutedReflectionProvider(config(), sharedBudget, environment, options);
    await waking.propose({
      identity: input.identity,
      state: {},
      observations: {},
      intentions: [],
      memories: [],
      outsideMessages: [],
    });
    const first = await resting.reflect(input);
    const second = await resting.reflect(input);
    expect(first.vignette).not.toBe(second.vignette);
    expect(events).toEqual([
      'reserve:decision',
      'fetch:decision',
      'settle:reservation-1:false:20',
      'reserve:reflection',
      'fetch:reflection',
      'settle:reservation-2:false:20',
      'reserve:reflection',
      'fetch:reflection',
      'settle:reservation-3:false:20',
    ]);
    expect(sharedBudget.settle).toHaveBeenLastCalledWith(
      'reservation-3',
      { inputTokens: 40, outputTokens: 20, cachedInputTokens: 30 },
      false,
    );
    expect(resting.router.stats()).toMatchObject({ attempts: 2, resultCacheHits: 0, coalesced: 0 });
    const body = String(fetcher.mock.calls[1][1]?.body);
    expect(body).not.toContain('PRIVATE-KEY-CANARY');
    expect(JSON.parse(body).prompt_cache_key).toMatch(/^ew-[a-f0-9]{64}$/);
  });

  it('does not dispatch when the durable shared allowance refuses a reservation', async () => {
    const fetcher = vi.fn();
    const events: string[] = [];
    const sharedBudget = budget(events, false);
    const provider = new RoutedReflectionProvider(
      config(),
      sharedBudget,
      { MODEL_FIXTURE_KEY: 'fixture' },
      { fetcher: fetcher as typeof fetch },
    );
    await expect(provider.reflect(input)).rejects.toThrow(/allowance/);
    expect(events).toEqual(['reserve:reflection']);
    expect(fetcher).not.toHaveBeenCalled();
    expect(sharedBudget.settle).not.toHaveBeenCalled();
  });

  it('retains received usage for invalid output and unknown usage for malformed counts', async () => {
    for (const usage of [
      { prompt_tokens: 40, completion_tokens: 20 },
      { prompt_tokens: '40', completion_tokens: -1 },
    ]) {
      const events: string[] = [];
      const sharedBudget = budget(events);
      const fetcher = (async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"type":"rest"}' } }], usage }),
        )) as typeof fetch;
      const provider = new RoutedReflectionProvider(
        config(),
        sharedBudget,
        { MODEL_FIXTURE_KEY: 'fixture' },
        { fetcher },
      );
      await expect(provider.reflect(input)).rejects.toThrow(/unavailable/);
      expect(sharedBudget.settle).toHaveBeenCalledWith(
        'reservation-1',
        typeof usage.prompt_tokens === 'number'
          ? { inputTokens: 40, outputTokens: 20, cachedInputTokens: 0 }
          : undefined,
        true,
      );
    }
  });

  it('uses a local reflection route without requiring unrelated waking credentials', async () => {
    const local = modelProfile('local', {
      transport: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      apiKeyEnv: undefined,
      local: true,
      promptCache: 'none',
      rates: { inputUsdPerMillion: 0, outputUsdPerMillion: 0, cachedInputUsdPerMillion: 0 },
    });
    const fetcher = vi.fn(
      async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(JSON.stringify(transports[0].payload(proposal))),
    );
    const provider = new RoutedReflectionProvider(
      routingConfig({
        profiles: [modelProfile(), local],
        policies: { decision: modelPolicy(), reflection: modelPolicy({ models: ['local'] }) },
      }),
      budget([]),
      {},
      { fetcher: fetcher as typeof fetch },
    );
    expect(provider.localOnly).toBe(true);
    expect(await provider.reflect(input)).toEqual(proposal);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).format).toEqual(REFLECTION_FORMAT);
  });

  it('requires an explicit reflection policy and avoids cached responses or retries at Cloudflare', async () => {
    expect(() => new RoutedReflectionProvider(routingConfig(), budget([]), {})).toThrow(
      /reflection workload policy/,
    );
    const fetcher = vi.fn(
      async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(JSON.stringify(transports[1].payload(proposal))),
    );
    const provider = new RoutedReflectionProvider(
      routingConfig({
        profiles: [
          modelProfile('cf-routine', { gateway: 'cloudflare', promptCache: 'cloudflare' }),
        ],
        policies: { reflection: modelPolicy() },
      }),
      budget([]),
      { MODEL_FIXTURE_KEY: 'fixture' },
      { fetcher: fetcher as typeof fetch },
    );
    await provider.reflect(input);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      'cf-aig-skip-cache': 'true',
      'cf-aig-max-attempts': '1',
      'cf-aig-collect-log': 'false',
      'x-session-affinity': expect.stringMatching(/^ew-/),
    });
  });
});
