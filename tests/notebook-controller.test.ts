import { expect, it, vi } from 'vitest';
import {
  ElsewhereController,
  type ControllerState,
  type ControllerOptions,
} from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import { reserveModelCall } from '../packages/security/src/index';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
} from '../elsewhere/server/src/world';
import { advanceHubert, createInitialHubert, workingContext } from '../characters/hubert/src/index';

const epoch = Date.UTC(2026, 10, 9, 12);
const modelProvider = {
  id: 'notebook-test',
  managesAllowance: true,
  propose: async () => ({ type: 'reflect' }),
};
class MemoryStore implements SnapshotStore<ControllerState> {
  saved: StoredSnapshot<ControllerState> | null = null;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: ControllerState, expected: number) {
    expect(expected).toBe(this.saved?.version ?? 0);
    this.saved = { version: expected + 1, value: structuredClone(value) };
    return expected + 1;
  }
  async close() {}
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function fixture(options: ControllerOptions = {}) {
  const store = new MemoryStore();
  const first = await new ElsewhereController(store, { now: () => epoch }).init();
  await first.close();
  store.saved!.value.hubert.memories.push({
    id: 'public-mechanism',
    sourceEventId: 'public-receipt',
    createdAt: epoch,
    summary: 'Hubert inspected the copper mechanism. Its fin wobbled when the crank turned.',
    source: 'world-outcome',
    verified: true,
    cues: [{ kind: 'object', value: 'artifact' }],
    emotionalContext: { mood: 60, frustration: 5 },
    salience: 0.5,
    experience: { action: 'inspect', targetId: 'artifact', status: 'completed' },
  });
  store.saved!.value.hubert.outsideMessages.push({
    id: 'private-note',
    source: 'visitor',
    text: 'PRIVATE-NOTE-CANARY',
    at: epoch,
  });
  store.saved!.value.hubert.intent = 'PRIVATE-INTENT-CANARY';
  // Shared thoughts use the same provider; they are off here so every request counted is a note.
  store.saved!.value.hubert.thoughts = {
    day: '2026-11-09',
    calls: 0,
    lastAtReal: 0,
    entries: [],
    disabled: true,
  };
  store.saved!.value.hubert.memories.push({
    id: 'private-episode',
    sourceEventId: 'private-note',
    createdAt: epoch,
    summary: 'PRIVATE-MEMORY-CANARY',
    source: 'external-message',
    verified: false,
    cues: [],
    emotionalContext: { mood: 60, frustration: 5 },
    salience: 0.5,
  });
  const controller = await new ElsewhereController(store, {
    now: () => epoch,
    modelProvider,
    ...options,
  }).init();
  return { store, controller };
}
it('streams only explicitly public expression after a durable reservation, then retains its completed entry', async () => {
  const entered = deferred(),
    release = deferred();
  const express = vi.fn(async (input, onDelta) => {
    expect(JSON.stringify(input)).not.toMatch(/PRIVATE-|outsideMessages|dreams|wishes/);
    onDelta('The crooked fin ');
    entered.resolve();
    await release.promise;
    onDelta('is worth another look.');
    return 'The crooked fin is worth another look.';
  });
  const { store, controller } = await fixture({ expressionProvider: { id: 'fixture', express } });
  const tick = controller.tick();
  try {
    await entered.promise;
    expect(store.saved!.value.hubert.notebook?.pending).toBeTruthy();
    expect(store.saved!.value.modelAllowance.calls).toBe(1);
    expect(controller.getSnapshot().notebook?.draft?.text).toBe('The crooked fin ');
    expect(controller.getSnapshot().notebook?.entries).toEqual([]);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE-');
    release.resolve();
    await tick;
    expect(controller.getSnapshot().notebook?.draft).toBeUndefined();
    expect(controller.getSnapshot().notebook?.entries[0]).toMatchObject({
      text: 'The crooked fin is worth another look.',
      sourceIds: ['public-mechanism'],
    });
    expect(controller.getSnapshot().character.currentThought).toBeUndefined();
  } finally {
    release.resolve();
    await tick;
    await controller.close();
  }
});
it('does not pay to rewrite unchanged facts after reflection, a new day, restart or reset', async () => {
  let now = epoch;
  const express = vi.fn(async () => 'I want to understand that wobble.');
  const { store, controller } = await fixture({
    now: () => now,
    modelProvider,
    expressionProvider: { id: 'fixture', express },
  });
  await controller.tick();
  now += 25 * 60_000;
  await controller.tick();
  now += 86400000;
  await controller.tick();
  expect(express).toHaveBeenCalledTimes(1);
  await controller.close();
  const restarted = await new ElsewhereController(store, {
    now: () => now,
    modelProvider,
    expressionProvider: { id: 'fixture', express },
  }).init();
  try {
    await restarted.tick();
    expect(express).toHaveBeenCalledTimes(1);
    const before = store.saved!.value.hubert.notebook;
    await restarted.reset();
    expect(store.saved!.value.hubert.notebook?.lastAtReal).toBe(before?.lastAtReal);
    expect(store.saved!.value.hubert.notebook?.sourceIds).toEqual(before?.sourceIds);
    expect(store.saved!.value.hubert.notebook?.entries).toEqual([]);
  } finally {
    await restarted.close();
  }
});
it.each(['mismatch', 'overflow', 'nonstring', 'reject'] as const)(
  'discards a %s draft without publishing or replaying it',
  async (kind) => {
    const express = vi.fn(async (_input, onDelta) => {
      if (kind === 'overflow') onDelta('x'.repeat(361));
      else if (kind === 'nonstring') onDelta(17);
      else onDelta('An unfinished note.');
      if (kind === 'reject') throw Error('fixture');
      return 'A different finished note.';
    });
    const { controller, store } = await fixture({ expressionProvider: { id: 'fixture', express } });
    try {
      await controller.tick();
      expect(controller.getSnapshot().notebook?.entries).toEqual([]);
      expect(controller.getSnapshot().notebook?.draft).toBeUndefined();
      expect(store.saved!.value.hubert.notebook?.calls).toBe(1);
      expect(store.saved!.value.hubert.notebook?.pending).toBeUndefined();
      await controller.tick();
      expect(express).toHaveBeenCalledTimes(1);
    } finally {
      await controller.close();
    }
  },
);
it('keeps model allowance monotonic across wall-clock rollback', () => {
  const ledger = { day: '2026-11-10', calls: 2, inputTokens: 90, outputTokens: 10 };
  expect(reserveModelCall(ledger, epoch, 3)).toEqual({ ...ledger, calls: 3 });
  expect(reserveModelCall({ ...ledger, calls: 3 }, epoch, 3)).toBeNull();
});
it('lets interests emerge and fade while retaining encounters and memory evidence', () => {
  const state = createInitialHubert(epoch);
  expect(state.interests).toEqual([]);
  state.interests = [{ id: 'patterns', name: 'Patterns', strength: 0.13, encounters: 7 }];
  state.memories = [
    {
      id: 'old-pattern',
      sourceEventId: 'source',
      createdAt: epoch,
      summary: 'Saw a repeating pattern.',
      source: 'world-outcome',
      verified: true,
      cues: [],
      emotionalContext: { mood: 60, frustration: 5 },
      salience: 0.5,
    },
  ];
  let later = state;
  for (let i = 1; i <= 7; i++) later = advanceHubert(later, epoch + i * 6 * 3600000);
  expect(later.interests).toEqual([]);
  expect(later.dormantInterests[0]).toMatchObject({ id: 'patterns', encounters: 7 });
  expect(later.memories).toEqual(state.memories);
});
it('continues an uninterrupted rest without spamming fresh rest-start events', () => {
  let world = createInitialWorld(epoch);
  world = executeWorldCommand(world, 'hubert', { type: 'rest' }, epoch).world;
  world = advanceWorld(world, epoch + 90000);
  const continued = executeWorldCommand(world, 'hubert', { type: 'rest' }, epoch + 90000);
  expect(continued.world.events.filter((e) => e.type === 'rest')).toHaveLength(1);
  expect(continued.outcome.status).toBe('completed');
  expect(continued.outcome.summary).toContain('continued resting');
});

it('does not reopen a full note day after future unchanged facts and a clock rollback', async () => {
  let now = epoch;
  const express = vi.fn(async () => 'A quiet observation.');
  const { controller, store } = await fixture({
    now: () => now,
    modelProvider,
    expressionProvider: { id: 'fixture', express },
  });
  await controller.tick();
  await controller.close();
  store.saved!.value.hubert.notebook!.calls = 8;
  const previous = store.saved!.value.hubert.notebook!;
  const next = await new ElsewhereController(store, {
    now: () => now,
    modelProvider,
    expressionProvider: { id: 'fixture', express },
  }).init();
  try {
    now += 86400000;
    await next.tick();
    expect(store.saved!.value.hubert.notebook!.day).toBe(previous.day);
    expect(store.saved!.value.hubert.notebook!.calls).toBe(8);
    now = epoch + 30 * 60000;
    store.saved!.value.hubert.memories.push({
      ...store.saved!.value.hubert.memories[0],
      id: 'public-new-fact',
      sourceEventId: 'new-receipt',
      summary: 'A changed public mechanism.',
    });
    // A restarted controller consumes the persisted full-day ledger and genuinely changed facts.
    await next.close();
    const restarted = await new ElsewhereController(store, {
      now: () => now,
      modelProvider,
      expressionProvider: { id: 'fixture', express },
    }).init();
    try {
      await restarted.tick();
      expect(express).toHaveBeenCalledTimes(1);
      expect(store.saved!.value.hubert.notebook!.calls).toBe(8);
    } finally {
      await restarted.close();
    }
  } finally {
    await next.close();
  }
});

it('brings only the latest authored questions back into planning without treating them as executed outcomes', () => {
  const state = createInitialHubert(epoch);
  state.notebook = {
    day: '2026-11-09',
    calls: 3,
    latestAtReal: epoch,
    lastAtReal: epoch,
    sourceIds: [],
    entries: [
      { id: 'old-note', at: epoch, text: 'An old question.', sourceIds: ['source'] },
      { id: 'note-two', at: epoch, text: 'I wonder how that fin turns.', sourceIds: ['source'] },
      {
        id: 'note-three',
        at: epoch,
        text: 'I might read about small mechanisms.',
        sourceIds: ['source'],
      },
    ],
  };
  const observation = {
    characterId: 'hubert',
    observedAt: epoch,
    placeId: 'courtyard',
    position: { x: 2, z: 3 },
    facing: 0,
    visibleObjects: [],
    visibleEntities: [],
    events: [],
  };
  const context = workingContext(state, observation);
  expect(context.state.recentNotebook).toHaveLength(2);
  expect(JSON.stringify(context.state.recentNotebook)).toContain('small mechanisms');
  expect(JSON.stringify(context.state.recentNotebook)).not.toContain('An old question.');
  expect(state.memories).toEqual([]);
});

it('keeps a writing failure separate from decisions and retries its source only when the owner requests it', async () => {
  const express = vi
    .fn()
    .mockRejectedValueOnce(new Error('PRIVATE-WRITING-ERROR'))
    .mockResolvedValue('Could the crooked fin explain the wobble?');
  const { controller, store } = await fixture({ expressionProvider: { id: 'fixture', express } });
  try {
    await controller.tick();
    expect(controller.getCharacterIssues()[0]).toMatchObject({
      workload: 'notebook',
      kind: 'failed',
    });
    expect(controller.getSnapshot().notebook?.entries).toEqual([]);
    await controller.step();
    expect(express).toHaveBeenCalledTimes(1);
    expect(store.saved!.value.hubert.turn).toBeGreaterThan(0);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE-WRITING');
    await controller.retryCharacterProvider();
    expect(controller.getCharacterIssues()[0].resolvedAt).toBeUndefined();
    await controller.tick();
    expect(express).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().notebook?.entries[0].text).toContain('crooked fin');
    expect(controller.getCharacterIssues()[0].resolvedAt).toBe(epoch);
    expect(store.saved!.value.modelAllowance.calls).toBe(2);
  } finally {
    await controller.close();
  }
});
