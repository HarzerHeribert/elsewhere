import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import type { CharacterResearchPort } from '../characters/interfaces/src/research';
import { scriptedProvider, type ScriptedProvider } from './scripted-provider';

const start = Date.UTC(2026, 10, 9, 12, 10);
const PAGE = 'EXTERNAL-PAGE-CANARY: sparrows hop because short legs beat running.';
const source = {
  id: 'source-' + 'a'.repeat(24),
  title: 'Sparrow locomotion',
  url: 'https://example.com/sparrows',
  snippet: 'An external source.',
};
const OUTSIDE = 'The quick brown fox jumps over the lazy dog beside the quiet river bank.';

/** Survives a controller being closed, like a database file does. */
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
const open = new Set<ElsewhereController>();
afterEach(async () => {
  for (const controller of open) await controller.close();
  open.clear();
});
function port(): CharacterResearchPort & {
  search: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
} {
  return {
    search: vi.fn(async (input: { query: string }) => ({
      kind: 'search' as const,
      receiptId: 'receipt-search-' + input.query.length,
      provider: 'tavily' as const,
      query: input.query,
      fetchedAt: start,
      cached: false,
      sources: [source],
    })),
    read: vi.fn(async () => ({
      kind: 'read' as const,
      receiptId: 'receipt-read',
      sourceId: source.id,
      url: source.url,
      title: source.title,
      fetchedAt: start,
      cached: false,
      excerpt: PAGE,
      truncated: false,
    })),
  };
}
async function create(
  provider: ScriptedProvider,
  options: Partial<ConstructorParameters<typeof ElsewhereController>[1]> = {},
  store = new MemoryStore(),
) {
  const controller = await new ElsewhereController(store, {
    now: () => start,
    modelProvider: provider,
    ...options,
  }).init();
  open.add(controller);
  return { controller, store };
}
const pursue = {
  type: 'pursue' as const,
  question: 'Why do sparrows hop instead of walking?',
  why: 'I keep watching them cross the wall.',
};

describe('following a question', () => {
  it('carries the page text into the next decision and records the whole chain on the pursuit', async () => {
    const research = port();
    const provider = scriptedProvider([
      { action: pursue, why: 'This has hold of me.' },
      { action: { type: 'search', query: 'sparrow hopping gait' }, why: 'Start with the gait.' },
      { type: 'read', sourceId: source.id },
      {
        type: 'note',
        text: 'Hopping looks cheaper for short legs.',
        surprised: true,
        next: 'Do larger birds hop at all?',
        sourceIds: [source.id],
      },
      { type: 'search', query: 'which birds hop and which walk' },
    ]);
    const { controller, store } = await create(provider, { research });
    await controller.step();
    await controller.step();
    expect(research.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'sparrow hopping gait' }),
    );
    // The sources of that search are offered for reading, and only for this pursuit.
    await controller.step();
    expect(research.read).toHaveBeenCalledTimes(1);
    await controller.step();
    const decisionAfterRead = provider.contexts[3];
    const pursuits = decisionAfterRead.state.pursuits as {
      active: { question: string; entries: Array<{ kind: string }> };
      reading: Array<{ text: string; title: string }>;
    };
    expect(pursuits.reading).toEqual([
      expect.objectContaining({ text: PAGE, title: source.title }),
    ]);
    expect(pursuits.active.question).toBe(pursue.question);
    expect(pursuits.active.entries.map((entry) => entry.kind)).toEqual(['search', 'read']);
    // The read source is no longer offered; a note with a next question follows.
    expect((decisionAfterRead.state.research as { sources: unknown[] }).sources).toEqual([]);
    await controller.step();
    const saved = (await store.load())!.value.hubert;
    const active = saved.pursuits.items[0];
    expect(saved.pursuits.items).toHaveLength(1);
    expect(active.questions).toEqual(['Do larger birds hop at all?']);
    expect(active.entries.map((entry) => entry.kind)).toEqual(['search', 'read', 'note', 'search']);
    expect(saved.trail.map((entry) => entry.kind)).toEqual([
      'pursue',
      'search',
      'read',
      'note',
      'search',
    ]);
    expect(saved.trail[0]).toMatchObject({ why: 'This has hold of me.', text: pursue.question });
    expect(saved.trail.every((entry) => entry.pursuitId === active.id)).toBe(true);
    expect(saved.trail[2]).toMatchObject({ text: source.title, url: source.url });
    expect(saved.trail.every((entry) => entry.placeId === 'courtyard')).toBe(true);
    expect(saved.research.readIds).toEqual([source.id]);
    expect(saved.research.pending).toBeUndefined();
  });

  it('persists the attempt before the external call and keeps a failed source from being retried', async () => {
    const research = port();
    let pendingDuring: unknown;
    const backing = new MemoryStore();
    research.read.mockImplementation(async () => {
      pendingDuring = (await backing.load())!.value.hubert.research.pending;
      throw new Error('Unavailable');
    });
    const provider = scriptedProvider([
      pursue,
      { type: 'search', query: 'sparrow hopping gait' },
      { type: 'read', sourceId: source.id },
    ]);
    const { controller } = await create(provider, { research }, backing);
    await controller.step();
    await controller.step();
    await controller.step();
    expect(pendingDuring).toMatchObject({ kind: 'read' });
    const state = (await backing.load())!.value;
    expect(state.hubert.research.pending).toBeUndefined();
    expect(state.hubert.research.offers).toEqual([]);
    expect(state.hubert.lastOutcome).toMatchObject({ action: 'read', status: 'rejected' });
    expect(state.hubert.pursuits.reading).toEqual([]);
    expect(state.hubert.pursuits.items[0].entries.map((entry) => entry.kind)).toEqual(['search']);
    // No cooldown: the very next decision is made without waiting.
    provider.push({ type: 'rest' });
    await controller.step();
    expect(provider.remaining()).toBe(0);
  });

  it('clears an interrupted request after a restart and keeps the pursuits', async () => {
    const backing = new MemoryStore();
    const first = await create(scriptedProvider([pursue]), {}, backing);
    await first.controller.step();
    const saved = (await backing.load())!;
    saved.value.hubert.research.pending = { id: 'interrupted', kind: 'read' };
    await backing.save(saved.value, saved.version);
    const { controller } = await create(scriptedProvider(), {}, backing);
    const state = (await backing.load())!.value.hubert;
    expect(state.research.pending).toBeUndefined();
    expect(state.pursuits.items).toHaveLength(1);
    expect(controller.getSnapshot().pursuits).toHaveLength(1);
  });
});

describe('what cannot be done', () => {
  it('rejects a search or a note without an active pursuit and records nothing', async () => {
    const research = port();
    const provider = scriptedProvider([
      { type: 'search', query: 'sparrow hopping gait' },
      { type: 'note', text: 'A finding without a question.', surprised: false },
    ]);
    const { controller, store } = await create(provider, { research });
    await controller.step();
    let state = (await store.load())!.value.hubert;
    expect(state.lastDecisionProblem).toMatchObject({ code: 'unavailable_action' });
    expect(state.lastDecisionProblem?.message).toContain('active pursuit');
    expect(state.lastOutcome).toMatchObject({ action: 'search', status: 'rejected' });
    await controller.step();
    state = (await store.load())!.value.hubert;
    expect(state.lastDecisionProblem?.message).toContain('active pursuit');
    expect(state.lastOutcome).toMatchObject({ action: 'note', status: 'rejected' });
    expect(research.search).not.toHaveBeenCalled();
    expect(state.pursuits.items).toEqual([]);
    expect(state.trail).toEqual([]);
  });

  it('does not offer search without a pursuit, and not at all without research', async () => {
    const provider = scriptedProvider([pursue, { type: 'rest' }, { type: 'rest' }]);
    const { controller } = await create(provider, { research: port() });
    await controller.step();
    await controller.step();
    const offered = (index: number) =>
      provider.contexts[index].choices?.map((choice) => choice.type);
    expect(offered(0)).toContain('pursue');
    expect(offered(0)).not.toContain('search');
    expect(offered(0)).not.toContain('note');
    expect(offered(0)).not.toContain('set_aside');
    expect(offered(1)).toEqual(expect.arrayContaining(['search', 'note', 'set_aside']));
    const bare = scriptedProvider([pursue, { type: 'rest' }]);
    const other = await create(bare);
    await other.controller.step();
    await other.controller.step();
    expect(bare.contexts[1].choices?.map((choice) => choice.type)).not.toContain('search');
  });

  it.each([
    ['why', { action: { type: 'reflect' as const }, why: OUTSIDE.slice(4, 60) }],
    [
      'note text',
      {
        action: { type: 'note' as const, text: `They said: ${OUTSIDE}`, surprised: false },
        why: '',
      },
    ],
    [
      'question',
      {
        action: {
          type: 'pursue' as const,
          question: OUTSIDE.slice(0, 60),
          why: 'It is a good line.',
        },
        why: '',
      },
    ],
    [
      'next question',
      {
        action: {
          type: 'note' as const,
          text: 'A fresh thought.',
          surprised: false,
          next: OUTSIDE,
        },
        why: '',
      },
    ],
  ])(
    'rejects public text that repeats an outside message (%s) and records nothing',
    async (_name, decision) => {
      const provider = scriptedProvider([pursue, decision]);
      const { controller, store } = await create(provider);
      await controller.submitMessage(OUTSIDE);
      await controller.step();
      const afterPursue = (await store.load())!.value.hubert;
      await controller.step();
      const state = (await store.load())!.value.hubert;
      expect(state.lastDecisionProblem).toMatchObject({ code: 'unavailable_action' });
      expect(state.lastDecisionProblem?.message).toContain('outside message');
      expect(state.trail).toEqual(afterPursue.trail);
      expect(state.pursuits).toEqual(afterPursue.pursuits);
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('quiet river bank');
    },
  );
});

describe('pacing', () => {
  it('follows steps of the mind at once, and waits again after an action in the world', async () => {
    const provider = scriptedProvider(
      [
        pursue,
        { type: 'search', query: 'sparrow hopping gait' },
        { type: 'read', sourceId: source.id },
        { type: 'note', text: 'Short legs beat running.', surprised: false },
        { type: 'reflect' },
        { type: 'rest' },
      ],
      { fallback: { type: 'rest' } },
    );
    const { controller } = await create(provider, {
      research: port(),
      simulationStepMs: 10_000,
      decisionIntervalMs: 90_000,
    });
    for (let tick = 0; tick < 40; tick++) await controller.tick();
    const times = provider.contexts.map((context) => context.observations.observedAt as number);
    const gaps = times.slice(1).map((at, index) => at - times[index]);
    // Pursue, search, read and note are each followed up well inside the usual interval.
    expect(gaps.slice(0, 4).every((gap) => gap < 90_000)).toBe(true);
    // The reflection occupies its time and the interval before the next decision.
    expect(gaps[4]).toBeGreaterThanOrEqual(90_000);
  });
});

describe('working an object during a pursuit', () => {
  it('puts the reading on the trail and on the pursuit, and the rule on neither', async () => {
    const provider = scriptedProvider([pursue, { type: 'move', targetId: 'sundial' }], {
      fallback: { type: 'use', targetId: 'sundial', control: 'read' },
    });
    const { controller, store } = await create(provider, {
      simulationStepMs: 10_000,
      decisionIntervalMs: 20_000,
    });
    for (let tick = 0; tick < 80; tick++) await controller.tick();
    const saved = (await store.load())!.value.hubert;
    const used = saved.trail.filter((entry) => entry.kind === 'use');
    expect(used.length).toBeGreaterThan(0);
    expect(used[0].text).toMatch(/^The shadow is [\d.]+ cm long and falls toward \d+ degrees\.$/);
    expect(used[0].pursuitId).toBe(saved.pursuits.activeId);
    const tried = saved.pursuits.items[0].entries.filter((entry) => entry.kind === 'tried');
    expect(tried.length).toBeGreaterThan(0);
    expect(tried[0]).toMatchObject({ objectId: 'sundial' });
    expect(JSON.stringify(tried[0])).toContain(used[0].text!);
    expect(JSON.stringify(provider.contexts)).not.toMatch(/gnomon|mechanisms/);
  });
});

describe('the hourly call cap', () => {
  it('stops decisions quietly for the rest of the hour and resumes in the next one', async () => {
    let wall = start;
    const provider = scriptedProvider([], { fallback: { type: 'reflect' } });
    const { controller, store } = await create(provider, {
      now: () => wall,
      modelHourlyMaximum: 2,
      modelMaximum: 100,
    });
    await controller.step();
    await controller.step();
    expect(provider.contexts).toHaveLength(2);
    const status = controller.getSnapshot().runtime.modelStatus;
    await controller.step();
    await controller.step();
    expect(provider.contexts).toHaveLength(2);
    expect(controller.getCharacterIssues()).toEqual([]);
    expect(controller.getSnapshot().runtime.modelStatus).toBe(status);
    expect(controller.getSnapshot().character.activity).not.toBe('Currently unavailable');
    expect((await store.load())!.value.modelAllowance.calls).toBe(2);
    wall = Date.UTC(2026, 10, 9, 13, 0);
    await controller.step();
    expect(provider.contexts).toHaveLength(3);
    expect(controller.getCharacterIssues()).toEqual([]);
    expect((await store.load())!.value.modelAllowance).toMatchObject({
      calls: 3,
      hour: '2026-11-09T13',
      hourCalls: 1,
    });
  });

  it('still reports the daily cap as before', async () => {
    const provider = scriptedProvider([], { fallback: { type: 'reflect' } });
    const { controller } = await create(provider, { modelMaximum: 1, modelHourlyMaximum: 30 });
    await controller.step();
    await controller.step();
    expect(provider.contexts).toHaveLength(1);
    expect(controller.getCharacterIssues()).toContainEqual(
      expect.objectContaining({ kind: 'allowance' }),
    );
  });
});

describe('a saved life in the earlier shape', () => {
  it('is archived and replaced by a fresh character that keeps creations, wishes and the pause flag', async () => {
    for (const paused of [true, false]) {
      const backing = new MemoryStore();
      const first = await create(scriptedProvider(), {}, backing);
      await first.controller.close();
      open.delete(first.controller);
      const saved = (await backing.load())!;
      const legacy = saved.value as unknown as Record<string, any>;
      legacy.schemaVersion = 1;
      legacy.runtime.paused = paused;
      legacy.runtime.providerIssues = [
        {
          id: 'old',
          characterId: 'hubert',
          workload: 'notebook',
          kind: 'failed',
          since: 1,
          lastAt: 1,
          message: 'x',
        },
      ];
      legacy.creations = [
        {
          id: 'creation-1',
          characterId: 'hubert',
          title: 'A chart',
          description: 'Tallies',
          url: 'https://example.org/chart',
          kind: 'website',
          createdAt: 1,
          provenance: 'character',
        },
      ];
      legacy.hubert.wishes = [
        { id: 'wish-1', text: 'A bench by the pond.', createdAt: 5, status: 'pending' },
      ];
      legacy.hubert.interests = [{ id: 'birds', name: 'Birds', strength: 1, encounters: 3 }];
      legacy.hubert.notebook = { entries: [{ id: 'old-note', text: 'OLD-NOTEBOOK-CANARY' }] };
      legacy.modelAllowance.calls = 7;
      await backing.save(saved.value, saved.version);
      const archive = vi.fn();
      const { controller } = await create(
        scriptedProvider(),
        { archiveSnapshot: archive },
        backing,
      );
      expect(archive).toHaveBeenCalledOnce();
      expect(archive.mock.calls[0][0]).toMatchObject({ schemaVersion: 1 });
      expect(JSON.stringify(archive.mock.calls[0][0])).toContain('OLD-NOTEBOOK-CANARY');
      const state = (await backing.load())!.value;
      expect(state.schemaVersion).toBe(2);
      expect(state.runtime.paused).toBe(paused);
      expect(state.hubert.pursuits).toEqual({ items: [], reading: [] });
      expect(state.hubert.trail).toEqual([]);
      expect(state.hubert.memories).toEqual([]);
      expect(state.hubert.wishes.map((wish) => wish.id)).toEqual(['wish-1']);
      expect(state.creations?.map((creation) => creation.id)).toEqual(['creation-1']);
      expect(state.modelAllowance.calls).toBe(7);
      expect(state.runtime.providerIssues).toEqual([]);
      expect(JSON.stringify(state)).not.toContain('OLD-NOTEBOOK-CANARY');
      expect(controller.getSnapshot().runtime.paused).toBe(paused);
    }
  });

  it('survives a failing archive but still refuses an unknown version', async () => {
    const backing = new MemoryStore();
    const first = await create(scriptedProvider(), {}, backing);
    await first.controller.close();
    open.delete(first.controller);
    const saved = (await backing.load())!;
    (saved.value as unknown as { schemaVersion: number }).schemaVersion = 1;
    const version = await backing.save(saved.value, saved.version);
    const { controller } = await create(
      scriptedProvider(),
      {
        archiveSnapshot: () => {
          throw new Error('disk full');
        },
      },
      backing,
    );
    expect(controller.getSnapshot().pursuits).toEqual([]);
    await controller.close();
    open.delete(controller);
    const again = (await backing.load())!;
    expect(again.version).toBeGreaterThanOrEqual(version);
    (again.value as unknown as { schemaVersion: number }).schemaVersion = 99;
    await backing.save(again.value, again.version);
    await expect(new ElsewhereController(backing, { now: () => start }).init()).rejects.toThrow(
      /Unsupported persisted state/,
    );
  });
});

describe('what visitors can see', () => {
  it('publishes pursuits and the trail, never page text or outside messages', async () => {
    const research = port();
    const provider = scriptedProvider([
      { action: pursue, why: 'This has hold of me.' },
      { type: 'search', query: 'sparrow hopping gait' },
      { type: 'read', sourceId: source.id },
      { type: 'note', text: 'Hopping looks cheaper for short legs.', surprised: true },
      { type: 'rest' },
    ]);
    const { controller } = await create(provider, { research });
    await controller.submitMessage(OUTSIDE);
    for (let i = 0; i < 5; i++) await controller.step();
    const snapshot = controller.getSnapshot();
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain('EXTERNAL-PAGE-CANARY');
    expect(text).not.toContain('quiet river bank');
    expect(snapshot.pursuits).toHaveLength(1);
    expect(snapshot.pursuits[0]).toMatchObject({
      question: pursue.question,
      why: pursue.why,
      status: 'active',
    });
    expect(snapshot.pursuits[0].entries.map((entry) => entry.kind)).toEqual([
      'search',
      'read',
      'note',
    ]);
    expect(snapshot.trail.map((entry) => entry.kind)).toEqual([
      'pursue',
      'search',
      'read',
      'note',
      'rest',
    ]);
    expect(snapshot.trail[0].why).toBe('This has hold of me.');
    for (const gone of ['thoughts', 'notebook', 'research'])
      expect(snapshot).not.toHaveProperty(gone);
    expect(snapshot.character).not.toHaveProperty('interests');
  });
});
