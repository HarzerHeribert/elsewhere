import { describe, expect, it, vi } from 'vitest';
import { OllamaDecisionProvider } from './ollama';
const context = {
  identity: 'A trusted independent creature.',
  state: {},
  intentions: [],
  memories: [],
  observations: {},
  outsideMessages: [],
};
describe('native local Ollama adapter', () => {
  it('requests constrained local actions without credentials or hidden thinking', async () => {
    const usage = vi.fn();
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            message: { content: '{"type":"reflect"}' },
            prompt_eval_count: 120,
            eval_count: 8,
          }),
        ),
    );
    const provider = new OllamaDecisionProvider({
      fetcher: fetcher as typeof fetch,
      onUsage: usage,
    });
    expect(await provider.propose(context)).toEqual({ type: 'reflect' });
    const init = fetcher.mock.calls[0]?.[1];
    const sent = JSON.parse(String(init?.body));
    expect(sent.think).toBe(false);
    expect(sent.stream).toBe(false);
    expect(
      sent.format.anyOf.every(
        (action: { additionalProperties: boolean }) => action.additionalProperties === false,
      ),
    ).toBe(true);
    expect(init?.headers).not.toHaveProperty('authorization');
    expect(usage).toHaveBeenCalledWith(120, 8);
  });
  it('rejects invalid tools even if the local model emits one', async () => {
    const provider = new OllamaDecisionProvider({
      fetcher: (async () =>
        new Response(
          JSON.stringify({ message: { content: '{"type":"shell","command":"no"}' } }),
        )) as typeof fetch,
    });
    await expect(provider.propose(context)).rejects.toThrow();
  });
  it('does not silently send local tests to a remote service', () => {
    expect(() => new OllamaDecisionProvider({ baseUrl: 'https://ollama.com' })).toThrow();
    expect(
      () => new OllamaDecisionProvider({ baseUrl: 'http://user:password@127.0.0.1:11434' }),
    ).toThrow();
  });
});
