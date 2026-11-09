import { describe, expect, it, vi } from 'vitest';
import { SqliteSnapshotStore } from '../../persistence/src/index';
import { createResearchService, type ResearchServiceState } from './service';
import { searchProviders, SearchFailure } from './providers';
import { createResearchHttpServer } from './http';
import { ResearchClient } from './client';
import { encodeResearchBinding } from '../../../characters/interfaces/src/research';

const binding = {
  worldId: 'elsewhere',
  ownerUserId: 'fixture-owner',
  characterId: 'hubert',
  connectionId: 'hubert-web',
};
const source = {
  id: 'source-' + 'a'.repeat(24),
  url: 'https://example.com/birds',
  title: 'Birds',
  snippet: 'A source about birds.',
};
const epoch = Date.UTC(2026, 10, 9, 12);
async function fixture(limits: Partial<Parameters<typeof createResearchService>[0]> = {}) {
  let clock = epoch;
  const store = new SqliteSnapshotStore<ResearchServiceState>(':memory:');
  const providers = {
    tavilyEligible: vi.fn(async () => true),
    tavily: vi.fn(async () => [source]),
    searxng: vi.fn(async () => [source]),
  };
  const reader = vi.fn(async () => ({
    url: source.url,
    title: source.title,
    excerpt: 'Verified fetch; external claims remain unverified.',
    truncated: false,
  }));
  const options = { binding, store, providers, reader, now: () => clock, ...limits };
  return {
    service: await createResearchService(options),
    store,
    providers,
    reader,
    options,
    time: (t: number) => {
      clock = t;
    },
  };
}
describe('private research execution', () => {
  it('uses the primary allowance then durably falls back, including after restart', async () => {
    const h = await fixture({ monthlyTavilyLimit: 2 });
    try {
      for (let i = 0; i < 3; i++)
        expect(
          (await h.service.search({ requestId: 'request-' + i, query: 'bird topic ' + i }))
            .provider,
        ).toBe(i < 2 ? 'tavily' : 'searxng');
      expect(h.providers.tavily).toHaveBeenCalledTimes(2);
      const restarted = await createResearchService(h.options);
      expect(
        (await restarted.search({ requestId: 'request-four', query: 'fourth topic' })).provider,
      ).toBe('searxng');
      expect(restarted.status().month.tavilyCalls).toBe(2);
      h.time(epoch - 86_400_000);
      await restarted.search({ requestId: 'clock-rollback', query: 'another topic' });
      expect(h.providers.tavily).toHaveBeenCalledTimes(2);
      h.time(Date.UTC(2026, 11, 1));
      expect(
        (await restarted.search({ requestId: 'next-month', query: 'new month birds' })).provider,
      ).toBe('tavily');
    } finally {
      await h.service.close();
    }
  });
  it('reuses exact request receipts and cache without another primary dispatch', async () => {
    const h = await fixture();
    try {
      const a = await h.service.search({ requestId: 'same-request', query: 'bird behavior' });
      expect(await h.service.search({ requestId: 'same-request', query: 'bird behavior' })).toEqual(
        a,
      );
      expect(
        (await h.service.search({ requestId: 'new-request', query: 'bird behavior' })).cached,
      ).toBe(true);
      expect(h.providers.tavily).toHaveBeenCalledTimes(1);
      await expect(
        h.service.search({ requestId: 'same-request', query: 'different query' }),
      ).rejects.toThrow('invalid_request');
    } finally {
      await h.service.close();
    }
  });
  it('keeps failed/abandoned calls charged and never redispatches an uncertain request', async () => {
    const h = await fixture({ monthlyTavilyLimit: 1 });
    try {
      h.providers.tavily.mockRejectedValueOnce(new SearchFailure('temporary'));
      expect(
        (await h.service.search({ requestId: 'failed-primary', query: 'bird topic' })).provider,
      ).toBe('searxng');
      expect(h.service.status().month.tavilyCalls).toBe(1);
      const stored = (await h.store.load())!;
      stored.value.operations.push({ id: 'interrupted', fingerprint: 'irrelevant' });
      await h.store.save(stored.value, stored.version);
      const restarted = await createResearchService(h.options);
      await expect(
        restarted.search({ requestId: 'interrupted', query: 'bird topic' }),
      ).rejects.toThrow();
      expect(h.providers.tavily).toHaveBeenCalledTimes(1);
    } finally {
      await h.service.close();
    }
  });
  it('allows only sources discovered by this binding, bounds daily work and keeps reads off Tavily', async () => {
    const h = await fixture({ dailyReadLimit: 1 });
    try {
      await expect(
        h.service.read({ requestId: 'unknown-source', sourceId: 'source-' + 'b'.repeat(24) }),
      ).rejects.toThrow('not_granted');
      expect(h.reader).not.toHaveBeenCalled();
      h.time(epoch + 86_400_000);
      await h.service.search({ requestId: 'find-source', query: 'bird topic' });
      const read = await h.service.read({ requestId: 'read-source', sourceId: source.id });
      expect(read.excerpt).toContain('external');
      expect(h.providers.tavily).toHaveBeenCalledTimes(1);
      await expect(
        h.service.read({ requestId: 'too-many-reads', sourceId: source.id }),
      ).rejects.toThrow('limit');
      await expect(
        createResearchService({
          ...h.options,
          binding: { ...binding, ownerUserId: 'other-owner' },
        }),
      ).rejects.toThrow('another binding');
    } finally {
      await h.service.close();
    }
  });
  it('refuses dispatch after storage fails to reserve the request', async () => {
    const h = await fixture();
    try {
      vi.spyOn(h.store, 'save').mockRejectedValueOnce(Error('disk fixture'));
      await expect(
        h.service.search({ requestId: 'reserve-failed', query: 'bird topic' }),
      ).rejects.toThrow('storage_unavailable');
      expect(h.providers.tavily).not.toHaveBeenCalled();
      expect(h.providers.searxng).not.toHaveBeenCalled();
      expect(h.service.status().ready).toBe(false);
    } finally {
      await h.service.close();
    }
  });
  it('requires both the service credential and exact owner binding; browsers cannot call it', async () => {
    const h = await fixture(),
      token = 'fixture-research-token-'.repeat(3);
    const server = createResearchHttpServer({ service: h.service, binding, token });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No fixture listener');
    const url = 'http://127.0.0.1:' + address.port;
    try {
      expect((await fetch(url + '/v1/research/ready')).status).toBe(401);
      const headers = {
        authorization: 'Bearer ' + token,
        'x-elsewhere-research-binding': encodeResearchBinding({
          ...binding,
          ownerUserId: 'other-owner',
        }),
      };
      expect((await fetch(url + '/v1/research/ready', { headers })).status).toBe(403);
      headers['x-elsewhere-research-binding'] = encodeResearchBinding(binding);
      expect(
        (
          await fetch(url + '/v1/research/ready', {
            headers: { ...headers, origin: 'https://example.com' },
          })
        ).status,
      ).toBe(401);
      const client = new ResearchClient({ url, token, binding, allowPrivateHttp: true });
      expect(
        (await client.search({ requestId: 'http-request', query: 'bird topic' })).provider,
      ).toBe('tavily');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await h.service.close();
    }
  });
});

describe('paid search guard and basic request shape', () => {
  it('accepts the free Researcher account shape with no paygo and nullable limits', async () => {
    const p = searchProviders({
      tavilyKey: 'fixture-key-only',
      searxngUrl: 'http://search:8080/',
      fetcher: (async () =>
        Response.json({
          key: { usage: 0, limit: null },
          account: {
            current_plan: 'Researcher',
            plan_usage: 0,
            plan_limit: 1000,
            paygo_usage: 0,
            paygo_limit: null,
          },
        })) as typeof fetch,
    });
    expect(await p.tavilyEligible(AbortSignal.timeout(1000))).toBe(true);
  });
  it('checks free account usage and fixes all cost-changing options', async () => {
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) =>
      String(url).endsWith('/usage')
        ? Response.json({
            key: { usage: 0, limit: 1000 },
            account: { plan_usage: 0, plan_limit: 1000, paygo_limit: 0 },
          })
        : Response.json({ results: [source], usage: { credits: 1 } }),
    );
    const p = searchProviders({
      tavilyKey: 'fixture-key-only',
      searxngUrl: 'http://search:8080/',
      fetcher: fetcher as typeof fetch,
    });
    expect(await p.tavilyEligible(AbortSignal.timeout(1000))).toBe(true);
    await p.tavily('bird behavior', AbortSignal.timeout(1000));
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({
      search_depth: 'basic',
      auto_parameters: false,
      include_raw_content: false,
      include_answer: false,
      include_usage: true,
    });
  });
  it('refuses pay-as-you-go and unknown account accounting', async () => {
    for (const account of [
      { plan_usage: 0, plan_limit: 1000, paygo_limit: 10 },
      { plan_usage: 0, plan_limit: 1000 },
    ]) {
      const p = searchProviders({
        tavilyKey: 'fixture-key-only',
        searxngUrl: 'http://search:8080/',
        fetcher: (async () => Response.json({ account })) as typeof fetch,
      });
      await expect(p.tavilyEligible(AbortSignal.timeout(1000))).rejects.toThrow();
    }
  });
});
