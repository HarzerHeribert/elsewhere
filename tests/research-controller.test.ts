import { expect, it, vi } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';
import { observeWorld } from '../elsewhere/server/src/world';
import { readableSources } from '../characters/hubert/src/research';
import { workingContext } from '../characters/hubert/src/index';

it('lets Hubert choose an observed topic and read it, publishing explicit research evidence without transmitting a private note', async () => {
  let now = Date.UTC(2026, 10, 9, 12);
  const backing = new SqliteSnapshotStore<ControllerState>(':memory:');
  const source = {
    id: 'source-' + 'a'.repeat(24),
    title: 'Sparrow biology',
    url: 'https://example.com/sparrows',
    snippet: 'An external source.',
  };
  const search = vi.fn(async (input: { query: string }) => {
    expect(input.query).not.toContain('PRIVATE-NOTE-CANARY');
    expect((await backing.load())!.value.hubert.research?.pending?.kind).toBe('search');
    expect(c.getSnapshot().research?.at(-1)?.status).toBe('searching');
    return {
      kind: 'search' as const,
      receiptId: 'research-search-fixture',
      provider: 'tavily' as const,
      query: input.query,
      fetchedAt: now,
      cached: false,
      sources: [source],
    };
  });
  const read = vi.fn(async () => ({
    kind: 'read' as const,
    receiptId: 'research-read-fixture',
    sourceId: source.id,
    url: source.url,
    title: source.title,
    fetchedAt: now,
    cached: false,
    excerpt: 'EXTERNAL-PAGE-CANARY: an unverified website claim.',
    truncated: false,
  }));
  let turn = 0;
  const model = {
    id: 'fixture',
    propose: vi.fn(async (context) => {
      const research = context.state.research;
      expect(research.available).toBe(true);
      return ++turn === 1
        ? { type: 'research', targetId: research.targets[0].id }
        : { type: 'read', sourceId: source.id };
    }),
  };
  const c = await new ElsewhereController(backing, {
    now: () => now,
    modelProvider: model,
    research: { search, read },
  }).init();
  try {
    await c.submitMessage('PRIVATE-NOTE-CANARY');
    const before = (await backing.load())!.value.hubert;
    const found = await c.step();
    expect(search).toHaveBeenCalledTimes(1);
    expect(found.events.at(-1)?.type).toBe('web_search');
    expect(found.research?.at(-1)?.sources[0].status).toBe('returned');
    now += 120001;
    const after = await c.step();
    expect(read).toHaveBeenCalledTimes(1);
    expect(after.events.at(-1)?.type).toBe('web_read');
    const memory = after.memories.find((m) => m.sourceUrl === source.url);
    expect(memory?.summary).toContain('Sparrow biology');
    expect(memory?.sourceUrl).toBe(source.url);
    expect(JSON.stringify(after)).not.toContain('PRIVATE-NOTE-CANARY');
    expect(after.research?.at(-1)).toMatchObject({
      query: search.mock.calls[0][0].query,
      status: 'read',
      sources: [
        {
          url: source.url,
          status: 'read',
          excerpt: 'EXTERNAL-PAGE-CANARY: an unverified website claim.',
        },
      ],
    });
    const { research: _publicEvidence, ...rest } = after;
    expect(JSON.stringify(rest)).not.toContain('EXTERNAL-PAGE-CANARY');
    const saved = (await backing.load())!.value;
    expect(saved.hubert.memories.find((m) => m.source === 'web-reading')?.verified).toBe(false);
    expect(saved.hubert.interests).toEqual(before.interests);
    expect(
      JSON.stringify(workingContext(saved.hubert, observeWorld(saved.world, 'hubert'), now, true)),
    ).toContain('EXTERNAL-PAGE-CANARY');
    expect(saved.runtime.activityUntil! - saved.runtime.simulatedAt).toBe(120000);
  } finally {
    await c.close();
  }
});

it('defers unsupported targets without dispatching a user-chosen query', async () => {
  const backing = new SqliteSnapshotStore<ControllerState>(':memory:');
  const search = vi.fn();
  const c = await new ElsewhereController(backing, {
    now: () => Date.UTC(2026, 10, 9),
    research: { search, read: vi.fn() },
    modelProvider: {
      id: 'fixture',
      propose: async () => ({ type: 'research', targetId: 'PRIVATE-UNSEEN-QUERY' }),
    },
  }).init();
  try {
    await c.step();
    expect(search).not.toHaveBeenCalled();
    expect((await backing.load())!.value.hubert.intent).toContain('no longer available');
  } finally {
    await c.close();
  }
});

it('backs off unreadable sources and drops expired offers without inventing a reading memory', async () => {
  let now = Date.UTC(2026, 10, 9, 12);
  const backing = new SqliteSnapshotStore<ControllerState>(':memory:');
  const source = {
    id: 'source-' + 'b'.repeat(24),
    title: 'Unavailable page',
    url: 'https://example.com/birds',
    snippet: 'A source.',
  };
  let turn = 0;
  const read = vi.fn(async () => {
    throw Error('Unavailable');
  });
  const c = await new ElsewhereController(backing, {
    now: () => now,
    modelProvider: {
      id: 'fixture',
      propose: async (context) =>
        ++turn === 1
          ? {
              type: 'research',
              targetId: (context.state.research as { targets: { id: string }[] }).targets[0].id,
            }
          : { type: 'read', sourceId: source.id },
    },
    research: {
      search: async (input) => ({
        kind: 'search',
        receiptId: 'search-backoff',
        provider: 'searxng',
        query: input.query,
        fetchedAt: now,
        cached: false,
        sources: [source],
      }),
      read,
    },
  }).init();
  try {
    await c.step();
    now += 120001;
    const deferred = await c.step();
    expect(deferred.research?.at(-1)).toMatchObject({
      status: 'deferred',
      sources: [{ status: 'deferred' }],
    });
    const state = (await backing.load())!.value.hubert;
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.memories.some((m) => m.source === 'web-reading')).toBe(false);
    expect(readableSources(state, now + 120001)).toEqual([]);
    expect(readableSources(state, now + 6 * 3600000)).toHaveLength(1);
    expect(readableSources(state, now + 24 * 3600000)).toEqual([]);
  } finally {
    await c.close();
  }
});

it('restores completed research evidence and marks interrupted research deferred after restart', async () => {
  class MemoryStore implements SnapshotStore<ControllerState> {
    saved: StoredSnapshot<ControllerState> | null = null;
    async load() {
      return structuredClone(this.saved);
    }
    async save(value: ControllerState, expected: number) {
      this.saved = { version: expected + 1, value: structuredClone(value) };
      return expected + 1;
    }
    async close() {}
  }
  const store = new MemoryStore();
  const first = await new ElsewhereController(store, { now: () => 1000 }).init();
  await first.close();
  store.saved!.value.hubert.research = {
    lastAtReal: 1000,
    topics: {},
    readIds: ['source'],
    pending: { id: 'interrupted', kind: 'read' },
    episodes: [
      {
        id: 'search',
        at: 1000,
        topic: 'Robin',
        query: 'robin behavior',
        context: 'Following up on a robin encountered in Elsewhere.',
        status: 'reading',
        sources: [
          {
            id: 'source',
            url: 'https://example.org/robin',
            title: 'Robin biology',
            snippet: 'Bird behavior.',
            status: 'read',
            excerpt: 'A retained source excerpt.',
          },
        ],
      },
    ],
  };
  const restarted = await new ElsewhereController(store, { now: () => 2000 }).init();
  try {
    expect(restarted.getSnapshot().research?.at(-1)).toMatchObject({
      status: 'deferred',
      sources: [{ status: 'read', excerpt: 'A retained source excerpt.' }],
    });
    expect((await store.load())!.value.hubert.research?.pending).toBeUndefined();
  } finally {
    await restarted.close();
  }
});
