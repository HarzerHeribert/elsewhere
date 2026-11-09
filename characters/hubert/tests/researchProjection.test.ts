import { describe, expect, it } from 'vitest';
import { createInitialHubert } from '../src/index';
import {
  deferResearchEpisode,
  publicResearch,
  rememberResearch,
  startResearchEpisode,
} from '../src/research';

describe('public research history', () => {
  it('records search and reading separately without publishing private state', () => {
    const state = createInitialHubert(1000);
    state.intent = 'PRIVATE INTENT';
    state.research = {
      lastAtReal: 1000,
      topics: {},
      readIds: [],
      pending: { id: 'request', kind: 'search' },
    };
    startResearchEpisode(
      state,
      {
        id: 'request',
        kind: 'search',
        target: { id: 'robin', label: 'Robin', query: 'robin behavior' },
        placeId: 'orchard',
      },
      1000,
    );
    rememberResearch(
      state,
      {
        kind: 'search',
        receiptId: 'receipt',
        provider: 'searxng',
        query: 'robin behavior',
        fetchedAt: 1000,
        cached: false,
        sources: [
          {
            id: 'source',
            title: 'Robin study',
            url: 'https://example.org/robin',
            snippet: 'A study.',
          },
          { id: 'unsafe', title: 'Unsafe', url: 'https://user:password@example.org', snippet: '' },
        ],
      },
      1000,
    );
    expect(publicResearch(state)[0].sources).toHaveLength(1);
    expect(publicResearch(state)[0].sources[0].status).toBe('returned');
    startResearchEpisode(
      state,
      { id: 'read-request', kind: 'read', sourceId: 'source', placeId: 'orchard' },
      2000,
    );
    expect(publicResearch(state)[0].status).toBe('reading');
    rememberResearch(
      state,
      {
        kind: 'read',
        receiptId: 'read-receipt',
        sourceId: 'source',
        url: 'https://example.org/robin',
        title: 'Robin study',
        fetchedAt: 2000,
        cached: false,
        excerpt: 'Robins forage on the ground.',
        truncated: false,
      },
      2000,
    );
    expect(publicResearch(state)[0]).toMatchObject({
      status: 'read',
      sources: [{ status: 'read', excerpt: 'Robins forage on the ground.' }],
    });
    expect(JSON.stringify(publicResearch(state))).not.toMatch(/PRIVATE|password/);
    expect(state.memories.at(-1)?.source).toBe('web-reading');
  });
  it('keeps unavailable research factual and bounds retained history', () => {
    const state = createInitialHubert(1000);
    state.research = { lastAtReal: 1000, topics: {}, readIds: [] };
    for (let i = 0; i < 10; i++)
      startResearchEpisode(
        state,
        {
          id: `request-${i}`,
          kind: 'search',
          target: { id: 'robin', label: 'Robin', query: 'robin behavior' },
          placeId: 'orchard',
        },
        i,
      );
    deferResearchEpisode(state);
    expect(publicResearch(state)).toHaveLength(8);
    expect(publicResearch(state).at(-1)).toMatchObject({ status: 'deferred', sources: [] });
  });
});
