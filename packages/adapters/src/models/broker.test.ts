import { expect, it, vi } from 'vitest';
import { BrokerDecisionProvider, BrokerModelClient, BrokerReflectionProvider } from './broker';

const token = 'fixture-service-credential-'.repeat(2);
const expectedBinding = {
  worldId: 'elsewhere',
  ownerUserId: 'fixture-owner',
  characterId: 'hubert' as const,
  connectionId: 'fixture-plan',
};
const context = {
  identity: 'Only the private service owns identity.',
  state: { energy: 60 },
  intentions: ['Watch birds'],
  memories: [],
  observations: { placeId: 'courtyard' },
  outsideMessages: [{ source: 'visitor', text: 'A robin is by the wall.' }],
};
function client(fetcher: typeof fetch, options = {}) {
  return new BrokerModelClient({
    baseUrl: 'https://inference.example',
    token,
    expectedBinding,
    fetcher,
    ...options,
  });
}

it('preserves the shared context contract when optional object values are undefined', async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(JSON.parse(init!.body as string).context.state).toEqual({ energy: 60 });
    return Response.json({ value: { type: 'reflect' } });
  });
  await expect(
    new BrokerDecisionProvider(client(fetcher as typeof fetch)).propose({
      ...context,
      state: { energy: 60, optional: undefined },
    }),
  ).resolves.toEqual({ type: 'reflect' });
});

it('sends typed context to a fixed private service without persona, actor selectors or provider credentials', async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    expect(Object.keys(body)).toEqual(['context']);
    expect(body.context.identity).toBeUndefined();
    expect(body.context.outsideMessages).toEqual(context.outsideMessages);
    expect(new Headers(init!.headers).get('authorization')).toBe(`Bearer ${token}`);
    expect(init!.redirect).toBe('error');
    return Response.json({ value: { type: 'reflect' } });
  });
  expect(
    await new BrokerDecisionProvider(client(fetcher as typeof fetch)).propose(context),
  ).toEqual({ type: 'reflect' });
  expect(String(fetcher.mock.calls[0][0])).toBe('https://inference.example/v1/decision');
});

it.each([
  'http://inference.example',
  'http://8.8.8.8',
  'https://user:secret@inference.example',
  'https://inference.example?token=secret',
  'https://inference.example/private',
  'ftp://inference.example',
])('rejects unsafe or ambiguous service destinations: %s', (baseUrl) => {
  expect(
    () => new BrokerModelClient({ baseUrl, token, expectedBinding, allowPrivateHttp: true }),
  ).toThrow('invalid_configuration');
});

it('requires explicit private-network HTTP opt-in and preserves loopback development', () => {
  expect(
    () =>
      new BrokerModelClient({ baseUrl: 'http://elsewhere-inference:4001', token, expectedBinding }),
  ).toThrow();
  expect(
    () =>
      new BrokerModelClient({
        baseUrl: 'http://elsewhere-inference:4001',
        token,
        expectedBinding,
        allowPrivateHttp: true,
      }),
  ).not.toThrow();
  expect(
    () =>
      new BrokerModelClient({
        baseUrl: 'http://10.0.0.4:4001',
        token,
        expectedBinding,
        allowPrivateHttp: true,
      }),
  ).not.toThrow();
  expect(
    () => new BrokerModelClient({ baseUrl: 'http://127.0.0.1:4001', token, expectedBinding }),
  ).not.toThrow();
});

it('pauses after service quota refusal without retrying or selecting another billing path', async () => {
  let now = 1000;
  const fetcher = vi.fn(async () =>
    Response.json({ error: 'daily_limit', retryAfterMs: 60000 }, { status: 429 }),
  );
  const api = client(fetcher, { now: () => now });
  const provider = new BrokerDecisionProvider(api);
  await expect(provider.propose(context)).rejects.toThrow('daily_limit');
  expect(api.isAvailable()).toBe(false);
  await expect(provider.propose(context)).rejects.toThrow('paused');
  expect(fetcher).toHaveBeenCalledOnce();
  now += 60001;
  expect(api.isAvailable()).toBe(true);
});

it('keeps authorization failures paused and never prints raw service diagnostics', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ error: 'not_authorized', raw: 'fixture-upstream-secret' }, { status: 403 }),
  );
  const api = client(fetcher);
  await expect(new BrokerDecisionProvider(api).propose(context)).rejects.toThrow('request_failed');
  expect(api.isAvailable()).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('bounds response bodies and refuses unvalidated actions or dream targets', async () => {
  await expect(
    new BrokerDecisionProvider(client(async () => new Response('x'.repeat(64001)))).propose(
      context,
    ),
  ).rejects.toThrow('response_too_large');
  await expect(
    new BrokerDecisionProvider(
      client(async () => Response.json({ value: { type: 'shell', command: 'anything' } })),
    ).propose(context),
  ).rejects.toThrow();
  const reflection = new BrokerReflectionProvider(
    client(async () =>
      Response.json({
        value: {
          vignette: 'I imagined a bird.',
          impulses: [{ affordanceId: 'unknown', reason: 'do it' }],
        },
      }),
    ),
  );
  await expect(
    reflection.reflect({ identity: 'Hubert', episodes: [], affordances: [] }),
  ).rejects.toThrow('invalid_reflection');
});

it('reports usage attached to failed provider responses without exposing private error data', async () => {
  const onUsageDetails = vi.fn();
  const api = client(
    async () =>
      Response.json(
        {
          error: 'provider_unavailable',
          retryAfterMs: 60000,
          usage: { inputTokens: 30, outputTokens: 4, cachedInputTokens: 0 },
        },
        { status: 503 },
      ),
    { onUsageDetails },
  );
  await expect(new BrokerDecisionProvider(api).propose(context)).rejects.toThrow(
    'provider_unavailable',
  );
  expect(onUsageDetails).toHaveBeenCalledWith({
    inputTokens: 30,
    outputTokens: 4,
    cachedInputTokens: 0,
  });
});
