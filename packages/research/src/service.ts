import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ResearchBindingSchema,
  ResearchReadResultSchema,
  ResearchReadSchema,
  ResearchSearchResultSchema,
  ResearchSearchSchema,
  type ResearchBinding,
  type ResearchReadResult,
  type ResearchResult,
  type ResearchSearchResult,
  type ResearchSource,
} from '../../../characters/interfaces/src/research';
import { preflightConnector, type ConnectorBinding } from '../../security/src/connectors';
import type { SnapshotStore } from '../../persistence/src/index';
import { SearchFailure, type SearchProviders } from './providers';

const counter = z.number().int().nonnegative().safe();
const stateSchema = z
  .object({
    version: z.literal(1),
    binding: ResearchBindingSchema,
    latestAt: counter,
    month: z
      .object({
        id: z.string().regex(/^\d{4}-\d{2}$/),
        tavilyCalls: counter,
        exhausted: z.boolean(),
      })
      .strict(),
    day: z
      .object({ id: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), searches: counter, reads: counter })
      .strict(),
    primaryRetryAt: counter,
    sources: z
      .array(
        z
          .object({
            id: z.string(),
            url: z.string(),
            title: z.string(),
            snippet: z.string(),
            expiresAt: counter,
          })
          .strict(),
      )
      .max(100),
    cache: z
      .array(
        z
          .object({
            key: z.string(),
            expiresAt: counter,
            value: z.union([ResearchSearchResultSchema, ResearchReadResultSchema]),
          })
          .strict(),
      )
      .max(32),
    operations: z
      .array(
        z
          .object({
            id: z.string(),
            fingerprint: z.string(),
            result: z.union([ResearchSearchResultSchema, ResearchReadResultSchema]).optional(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
export type ResearchServiceState = z.infer<typeof stateSchema>;
export class ResearchUnavailable extends Error {
  constructor(
    readonly code:
      | 'not_granted'
      | 'invalid_request'
      | 'limit'
      | 'busy'
      | 'unavailable'
      | 'uncertain'
      | 'storage_unavailable',
  ) {
    super('Research ' + code);
  }
}
export async function createResearchService(options: {
  binding: ResearchBinding;
  store: SnapshotStore<ResearchServiceState>;
  providers: SearchProviders;
  reader: (
    url: string,
    signal: AbortSignal,
  ) => Promise<{ url: string; title: string; excerpt: string; truncated: boolean }>;
  now?: () => number;
  monthlyTavilyLimit?: number;
  dailySearchLimit?: number;
  dailyReadLimit?: number;
}) {
  const binding = ResearchBindingSchema.parse(options.binding),
    store = options.store;
  const maximum = options.monthlyTavilyLimit ?? 1000,
    dailySearch = options.dailySearchLimit ?? 50,
    dailyRead = options.dailyReadLimit ?? 100;
  if (
    ![maximum, dailySearch, dailyRead].every((v) => Number.isSafeInteger(v) && v >= 1) ||
    maximum > 1000 ||
    dailySearch > 100 ||
    dailyRead > 200
  )
    throw Error('Invalid research limits.');
  let version = 0,
    active = false,
    halted = false;
  const now = () => {
    const t = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(t) || t < 0) throw Error('Invalid research clock.');
    return t;
  };
  const saved = await store.load();
  let state: ResearchServiceState;
  if (saved) {
    state = stateSchema.parse(saved.value);
    version = saved.version;
    if (JSON.stringify(state.binding) !== JSON.stringify(binding))
      throw Error('Research store belongs to another binding.');
  } else {
    const t = now(),
      iso = new Date(t).toISOString();
    state = {
      version: 1,
      binding,
      latestAt: t,
      month: { id: iso.slice(0, 7), tavilyCalls: 0, exhausted: false },
      day: { id: iso.slice(0, 10), searches: 0, reads: 0 },
      primaryRetryAt: 0,
      sources: [],
      cache: [],
      operations: [],
    };
  }
  const persist = async () => {
    try {
      version = await store.save(state, version);
    } catch {
      halted = true;
      throw new ResearchUnavailable('storage_unavailable');
    }
  };
  if (!saved) await persist();
  const grant: ConnectorBinding = {
    id: binding.connectionId,
    actor: binding,
    revision: 1,
    enabled: true,
    grants: ['web.search', 'web.read'].map((capabilityId) => ({
      capabilityId,
      resourceIds: ['public-web'],
      approval: 'automatic' as const,
    })),
  };
  async function execute(kind: 'search' | 'read', raw: unknown): Promise<ResearchResult> {
    if (halted) throw new ResearchUnavailable('storage_unavailable');
    if (active) throw new ResearchUnavailable('busy');
    const schema = kind === 'search' ? ResearchSearchSchema : ResearchReadSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ResearchUnavailable('invalid_request');
    const input = parsed.data;
    const preflight = preflightConnector(
      binding,
      grant,
      {
        id: 'web.' + kind,
        effect: 'read',
        inputSchema: schema as z.ZodType<Record<string, unknown>>,
      },
      {
        bindingId: binding.connectionId,
        capabilityId: 'web.' + kind,
        expectedRevision: 1,
        resourceId: 'public-web',
        idempotencyKey: createHash('sha256').update(input.requestId).digest('hex'),
        input,
      },
      now(),
    );
    if (preflight.decision !== 'eligible') throw new ResearchUnavailable('not_granted');
    const fingerprint = createHash('sha256').update(JSON.stringify({ kind, input })).digest('hex');
    const previous = state.operations.find((x) => x.id === input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ResearchUnavailable('invalid_request');
      if (!previous.result) throw new ResearchUnavailable('uncertain');
      return structuredClone(previous.result);
    }
    active = true;
    try {
      const at = Math.max(state.latestAt, now());
      state.latestAt = at;
      const iso = new Date(at).toISOString(),
        month = iso.slice(0, 7),
        day = iso.slice(0, 10);
      if (month > state.month.id) state.month = { id: month, tavilyCalls: 0, exhausted: false };
      if (day > state.day.id) state.day = { id: day, searches: 0, reads: 0 };
      state.sources = state.sources.filter((x) => x.expiresAt > at);
      state.cache = state.cache.filter((x) => x.expiresAt > at);
      if (kind === 'search' ? state.day.searches >= dailySearch : state.day.reads >= dailyRead)
        throw new ResearchUnavailable('limit');
      kind === 'search' ? state.day.searches++ : state.day.reads++;
      state.operations.push({ id: input.requestId, fingerprint });
      state.operations = state.operations.slice(-2000);
      await persist(); // Reserve before any network I/O; failures/restarts never refund a request.
      const key =
        kind +
        ':' +
        (kind === 'search'
          ? (input as { query: string }).query.toLowerCase().replace(/\s+/g, ' ')
          : (input as { sourceId: string }).sourceId);
      const cached = state.cache.find((x) => x.key === key);
      let result: ResearchResult;
      if (cached) {
        result = {
          ...structuredClone(cached.value),
          receiptId: 'research-' + randomUUID(),
          cached: true,
        };
      } else if (kind === 'search') {
        const query = (input as { query: string }).query;
        let sources: ResearchSource[] | undefined,
          provider: 'tavily' | 'searxng' = 'searxng';
        if (
          !state.month.exhausted &&
          state.month.tavilyCalls < maximum &&
          at >= state.primaryRetryAt
        ) {
          try {
            const eligible = await options.providers.tavilyEligible(AbortSignal.timeout(6000));
            if (eligible) {
              state.month.tavilyCalls++;
              await persist();
              sources = await options.providers.tavily(query, AbortSignal.timeout(8000));
              provider = 'tavily';
            } else {
              state.month.exhausted = true;
              await persist();
            }
          } catch (error) {
            if (halted) throw error;
            if (
              error instanceof SearchFailure &&
              ['quota', 'usage_unknown', 'paid_disabled'].includes(error.kind)
            )
              state.month.exhausted = true;
            else state.primaryRetryAt = at + 300_000;
            await persist();
          }
        }
        if (!sources) sources = await options.providers.searxng(query, AbortSignal.timeout(8000));
        for (const source of sources) {
          state.sources = state.sources.filter((x) => x.id !== source.id);
          state.sources.push({ ...source, expiresAt: at + 86_400_000 });
        }
        state.sources = state.sources.slice(-100);
        result = {
          kind: 'search',
          receiptId: 'research-' + randomUUID(),
          provider,
          query,
          fetchedAt: at,
          cached: false,
          sources,
        };
      } else {
        const sourceId = (input as { sourceId: string }).sourceId;
        const source = state.sources.find((x) => x.id === sourceId);
        if (!source) throw new ResearchUnavailable('not_granted');
        const page = await options.reader(source.url, AbortSignal.timeout(8000));
        result = ResearchReadResultSchema.parse({
          kind: 'read',
          receiptId: 'research-' + randomUUID(),
          sourceId,
          ...page,
          fetchedAt: at,
          cached: false,
        });
      }
      if (!cached) {
        state.cache.push({ key, expiresAt: at + 3_600_000, value: result });
        state.cache = state.cache.slice(-32);
      }
      state.operations.find((x) => x.id === input.requestId)!.result = result;
      await persist();
      return structuredClone(result);
    } catch (error) {
      if (error instanceof ResearchUnavailable) throw error;
      throw new ResearchUnavailable('unavailable');
    } finally {
      active = false;
    }
  }
  return {
    search: (input: unknown) => execute('search', input) as Promise<ResearchSearchResult>,
    read: (input: unknown) => execute('read', input) as Promise<ResearchReadResult>,
    status: () => ({
      ready: !halted,
      binding,
      month: structuredClone(state.month),
      day: structuredClone(state.day),
      primaryRetryAt: state.primaryRetryAt,
    }),
    close: () => store.close(),
  };
}
