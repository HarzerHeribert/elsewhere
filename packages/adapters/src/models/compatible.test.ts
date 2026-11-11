import { describe, expect, it, vi } from 'vitest';
import { CompatibleDecisionProvider } from './compatible';
const context = {
  identity: 'A trusted independent creature.',
  state: {},
  intentions: [],
  memories: [],
  observations: {},
  outsideMessages: [],
};

describe('replaceable real-model boundary', () => {
  it('supports explicit prefix keys, cache accounting and Cloudflare action-cache/retry opt-outs', async () => {
    const details = vi.fn();
    const fetcher = vi.fn(
      async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"type":"reflect"}' } }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              prompt_tokens_details: { cached_tokens: 80 },
            },
          }),
        ),
    );
    const provider = new CompatibleDecisionProvider({
      baseUrl: 'https://gateway.example.invalid/v1',
      model: 'fixture',
      apiKey: 'fixture',
      promptCacheKey: 'opaque-fixture',
      sessionAffinity: 'opaque-session',
      cloudflareGateway: true,
      maxOutputTokens: 160,
      fetcher: fetcher as typeof fetch,
      onUsageDetails: details,
    });
    await provider.propose(context);
    expect(details).toHaveBeenCalledWith({
      inputTokens: 100,
      outputTokens: 10,
      cachedInputTokens: 80,
    });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      'cf-aig-skip-cache': 'true',
      'x-session-affinity': 'opaque-session',
      'cf-aig-max-attempts': '1',
      'cf-aig-collect-log': 'false',
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      max_tokens: 160,
      prompt_cache_key: 'opaque-fixture',
    });
  });
  it('validates proposals and accounts for usage without returning credentials', async () => {
    const usage = vi.fn();
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"action":{"type":"rest","durationMs":60000},"why":"I am tired"}',
                },
              },
            ],
            usage: { prompt_tokens: 32, completion_tokens: 8 },
          }),
          { status: 200 },
        ),
    );
    const adapter = new CompatibleDecisionProvider({
      baseUrl: 'https://provider.example/v1',
      model: 'test',
      apiKey: 'test-key',
      fetcher: fetcher as typeof fetch,
      onUsage: usage,
    });
    expect(await adapter.propose(context)).toEqual({
      action: { type: 'rest', durationMs: 60000 },
      why: 'I am tired',
    });
    // The older bare action reply is still understood.
    expect(usage).toHaveBeenCalledWith(32, 8);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://provider.example/v1/chat/completions');
  });
  it('rejects arbitrary operations returned by a provider', async () => {
    const adapter = new CompatibleDecisionProvider({
      baseUrl: 'https://provider.example/v1',
      model: 'test',
      apiKey: 'test',
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"type":"shell","command":"no"}' } }],
          }),
        )) as typeof fetch,
    });
    await expect(adapter.propose(context)).rejects.toThrow();
  });
  it('refuses credentials embedded in endpoints and nonlocal cleartext transport', () => {
    expect(
      () =>
        new CompatibleDecisionProvider({
          baseUrl: 'https://secret@example.com/v1',
          model: 'test',
          apiKey: 'test',
        }),
    ).toThrow();
    expect(
      () =>
        new CompatibleDecisionProvider({
          baseUrl: 'http://example.com/v1',
          model: 'test',
          apiKey: 'test',
        }),
    ).toThrow();
  });
});
