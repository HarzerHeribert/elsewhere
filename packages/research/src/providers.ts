import { createHash } from 'node:crypto';
import type { ResearchSource } from '../../../characters/interfaces/src/research';
import { publicWebUrl } from './reader';

import { boundedJson } from './json';

const text = (value: unknown, maximum: number) =>
  typeof value === 'string'
    ? value
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum)
    : '';
export function searchSources(data: unknown): ResearchSource[] {
  if (!Array.isArray(data)) throw Error('Invalid search results.');
  const found = new Map<string, ResearchSource>();
  for (const row of data.slice(0, 30)) {
    if (!row || typeof row !== 'object') continue;
    const candidate = row as Record<string, unknown>;
    try {
      const url = publicWebUrl(String(candidate.url)).href;
      const title = text(candidate.title, 180);
      if (!title) continue;
      const id = 'source-' + createHash('sha256').update(url).digest('hex').slice(0, 24);
      found.set(id, { id, url, title, snippet: text(candidate.content ?? candidate.snippet, 600) });
      if (found.size >= 5) break;
    } catch {
      /* Unsupported/private result addresses are never offered. */
    }
  }
  return [...found.values()];
}
export class SearchFailure extends Error {
  constructor(readonly kind: 'quota' | 'temporary' | 'usage_unknown' | 'paid_disabled') {
    super('Search provider unavailable.');
  }
}
export interface SearchProviders {
  tavilyEligible(signal: AbortSignal): Promise<boolean>;
  tavily(query: string, signal: AbortSignal): Promise<ResearchSource[]>;
  searxng(query: string, signal: AbortSignal): Promise<ResearchSource[]>;
}
export function searchProviders(options: {
  tavilyKey?: string;
  searxngUrl: string;
  fetcher?: typeof fetch;
}): SearchProviders {
  const fetcher = options.fetcher ?? fetch;
  const base = new URL(options.searxngUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    throw Error('Invalid private search endpoint.');
  const authorized = { authorization: 'Bearer ' + (options.tavilyKey ?? '') };
  return {
    async tavilyEligible(signal) {
      if (!options.tavilyKey) return false;
      const r = await fetcher('https://api.tavily.com/usage', {
        headers: authorized,
        redirect: 'error',
        signal,
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw new SearchFailure('temporary');
      }
      const usage = await boundedJson(r);
      const account = usage.account as Record<string, unknown> | undefined,
        key = usage.key as Record<string, unknown> | undefined;
      const current = account?.plan_usage,
        limit = account?.plan_limit,
        paygo = account?.paygo_limit;
      // This first connector is deliberately free-plan-only. No account/card spending is enabled.
      if (
        (paygo !== 0 &&
          !(
            paygo === null &&
            account?.current_plan === 'Researcher' &&
            account?.paygo_usage === 0
          )) ||
        typeof limit !== 'number' ||
        limit > 1000
      )
        throw new SearchFailure('paid_disabled');
      if (
        typeof current !== 'number' ||
        !Number.isSafeInteger(current) ||
        current < 0 ||
        limit <= 0
      )
        throw new SearchFailure('usage_unknown');
      if (current >= Math.min(limit, 1000)) return false;
      if (
        typeof key?.usage === 'number' &&
        typeof key.limit === 'number' &&
        key.limit > 0 &&
        key.usage >= key.limit
      )
        return false;
      return true;
    },
    async tavily(query, signal) {
      const r = await fetcher('https://api.tavily.com/search', {
        method: 'POST',
        headers: { ...authorized, 'content-type': 'application/json' },
        redirect: 'error',
        signal,
        body: JSON.stringify({
          query,
          topic: 'general',
          search_depth: 'basic',
          auto_parameters: false,
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_usage: true,
        }),
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw new SearchFailure([432, 433].includes(r.status) ? 'quota' : 'temporary');
      }
      const body = await boundedJson(r);
      if ((body.usage as { credits?: unknown } | undefined)?.credits !== 1)
        throw new SearchFailure('usage_unknown');
      return searchSources(body.results);
    },
    async searxng(query, signal) {
      const url = new URL('search', base);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('safesearch', '1');
      const r = await fetcher(url, {
        redirect: 'error',
        signal,
        headers: { accept: 'application/json' },
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw new SearchFailure('temporary');
      }
      return searchSources((await boundedJson(r)).results);
    },
  };
}
