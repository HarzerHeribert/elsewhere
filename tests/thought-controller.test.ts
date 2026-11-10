import { expect, it, vi } from 'vitest';
import {
  ElsewhereController,
  type ControllerOptions,
  type ControllerState,
} from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import { publicSnapshot } from '../elsewhere/server/src/http';
import { expressionMessages } from '../packages/adapters/src/models/expression';

const epoch = Date.UTC(2026, 10, 9, 12);
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
/** A world whose private state is full of canaries and whose notebook has nothing new to say. */
async function fixture(options: ControllerOptions, clock = { now: epoch }) {
  const store = new MemoryStore();
  await (await new ElsewhereController(store, { now: () => epoch }).init()).close();
  const hubert = store.saved!.value.hubert;
  hubert.outsideMessages.push({
    id: 'private-note',
    source: 'visitor',
    text: 'PRIVATE-NOTE-CANARY',
    at: epoch,
  });
  hubert.intent = 'PRIVATE-INTENT-CANARY';
  hubert.lastReflection = 'PRIVATE-REFLECTION-CANARY';
  hubert.memories.push({
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
    now: () => clock.now,
    modelProvider: {
      id: 'thought-test',
      managesAllowance: true,
      propose: async () => ({ type: 'reflect' }),
    },
    ...options,
  }).init();
  return { store, controller, clock };
}
const thoughtsOnly = (text: string | (() => string)) =>
  vi.fn(async (input: { form?: string }) =>
    input.form === 'thought' ? (typeof text === 'string' ? text : text()) : '',
  );

it('authors a thought from public fields only and publishes it outside the character state', async () => {
  const express = thoughtsOnly('The pond looks different from this side.');
  const { controller } = await fixture({ expressionProvider: { id: 'fixture', express } });
  const snapshot = await controller.tick();
  const inputs = express.mock.calls.map(([input]) => input).filter((i) => i.form === 'thought');
  expect(inputs).toHaveLength(1);
  expect(JSON.stringify(inputs[0])).not.toMatch(/PRIVATE-|outsideMessages|intent|dreams|wishes/);
  expect(JSON.stringify(expressionMessages('Hubert.', inputs[0] as never))).not.toContain('"form"');
  expect(snapshot.thoughts).toMatchObject({ available: true, enabled: true });
  expect(snapshot.thoughts!.entries).toEqual([
    expect.objectContaining({ text: 'The pond looks different from this side.' }),
  ]);
  // The decision-time fields stay unpublished; a thought is its own authored record.
  expect(snapshot.character.currentThought).toBeUndefined();
  expect(snapshot.character.lastReflection).toBeUndefined();
  expect(JSON.stringify(publicSnapshot(snapshot))).not.toContain('PRIVATE-');
  expect(publicSnapshot(snapshot).thoughts!.entries).toHaveLength(1);
  await controller.close();
});

it('never asks twice about the same moment and waits between thoughts', async () => {
  let count = 0;
  const express = thoughtsOnly(() => `Thought ${++count}.`);
  const { controller, store, clock } = await fixture({
    expressionProvider: { id: 'fixture', express },
  });
  const asked = () => express.mock.calls.filter(([input]) => input.form === 'thought').length;
  await controller.tick();
  await controller.tick();
  expect(asked()).toBe(1);
  // A new moment inside the waiting period is still not a reason to ask.
  store.saved!.value.hubert.thoughts!.lastKey = 'an earlier moment';
  await controller.close();
  const again = await new ElsewhereController(store, {
    now: () => clock.now,
    expressionProvider: { id: 'fixture', express },
  }).init();
  await again.tick();
  expect(asked()).toBe(1);
  clock.now += 16 * 60_000;
  await again.tick();
  expect(asked()).toBe(2);
  expect(again.getSnapshot().thoughts!.entries.map((entry) => entry.text)).toEqual([
    'Thought 1.',
    'Thought 2.',
  ]);
  await again.close();
});

it('does not publish a thought that is too long, multi-line or structured', async () => {
  for (const text of ['x'.repeat(201), 'One line.\nAnother line.', '{"thought":"no"}']) {
    const express = thoughtsOnly(text);
    const { controller } = await fixture({ expressionProvider: { id: 'fixture', express } });
    const snapshot = await controller.tick();
    expect(snapshot.thoughts!.entries).toEqual([]);
    await controller.close();
  }
});

it('lets the owner switch thoughts off, and keeps the last fifth of the allowance for decisions', async () => {
  const express = thoughtsOnly('A thought.');
  const { controller } = await fixture({ expressionProvider: { id: 'fixture', express } });
  expect((await controller.setThoughts(false)).thoughts).toMatchObject({
    available: true,
    enabled: false,
  });
  await controller.tick();
  expect(express.mock.calls.filter(([input]) => input.form === 'thought')).toHaveLength(0);
  await controller.close();

  const spent = await fixture({
    expressionProvider: { id: 'fixture', express },
    modelMaximum: 10,
  });
  await spent.controller.close();
  spent.store.saved!.value.modelAllowance.calls = 8;
  const limited = await new ElsewhereController(spent.store, {
    now: () => epoch,
    expressionProvider: { id: 'fixture', express },
    modelMaximum: 10,
  }).init();
  await limited.tick();
  expect(express.mock.calls.filter(([input]) => input.form === 'thought')).toHaveLength(0);
  expect(limited.getSnapshot().runtime.modelCalls).toBe(8);
  await limited.close();
});

it('offers no thoughts without a provider that can author them', async () => {
  const { controller } = await fixture({});
  expect((await controller.tick()).thoughts).toEqual({
    available: false,
    enabled: false,
    entries: [],
  });
  await controller.close();
});
