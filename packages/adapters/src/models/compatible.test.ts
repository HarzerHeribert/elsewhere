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
  it('validates proposals and accounts for usage without returning credentials', async () => {
    const usage = vi.fn();
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"type":"rest","durationMs":60000}' } }],
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
    expect(await adapter.propose(context)).toEqual({ type: 'rest', durationMs: 60000 });
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
