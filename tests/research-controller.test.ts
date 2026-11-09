import { expect, it, vi } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';
import { observeWorld } from '../elsewhere/server/src/world';
import { workingContext } from '../characters/hubert/src/index';

it('lets Hubert choose an observed topic and read it, without transmitting a private note or publishing page text', async () => {
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
    now += 120001;
    const after = await c.step();
    expect(read).toHaveBeenCalledTimes(1);
    expect(after.events.at(-1)?.type).toBe('web_read');
    const memory = after.memories.find((m) => m.sourceUrl === source.url);
    expect(memory?.summary).toContain('external web source');
    expect(JSON.stringify(after)).not.toMatch(/EXTERNAL-PAGE-CANARY|PRIVATE-NOTE-CANARY/);
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
