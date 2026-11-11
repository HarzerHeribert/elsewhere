import { afterEach, describe, expect, it } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import type { CharacterCommand } from '@elsewhere/character-interfaces';
import { scriptedProvider, type ScriptedProvider } from './scripted-provider';

const start = Date.UTC(2026, 10, 9, 12, 10);
const MESSAGE = 'The quick brown fox jumps over the lazy dog beside the quiet river bank.';
const REPLY = 'Thank you, a heron stood very still there this morning and I watched it.';

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
async function create(provider: ScriptedProvider) {
  const store = new MemoryStore();
  const controller = await new ElsewhereController(store, {
    now: () => start,
    modelProvider: provider,
  }).init();
  open.add(controller);
  return { controller, store };
}
const idOf = (store: MemoryStore, index = 0) => store.saved!.value.hubert.outsideMessages[index].id;
const reply = (messageId: string, text = REPLY): CharacterCommand => ({
  type: 'reply',
  messageId,
  text,
});

describe('answering a message', () => {
  it('stores one private reply, rejects a second and an unknown id', async () => {
    const provider = scriptedProvider([], { fallback: { type: 'rest' } });
    const { controller, store } = await create(provider);
    await controller.submitMessage(MESSAGE, { userId: 'ann', displayName: 'Ann' });
    const id = idOf(store);
    provider.push(reply(id));
    await controller.step();
    const stored = store.saved!.value.hubert.outsideMessages[0];
    expect(stored.reply).toMatchObject({ text: REPLY });
    expect(store.saved!.value.hubert.lastOutcome).toMatchObject({
      action: 'reply',
      status: 'completed',
    });

    provider.push(reply(id, 'A second answer that should never be stored.'));
    await controller.step();
    expect(store.saved!.value.hubert.outsideMessages[0].reply!.text).toBe(REPLY);
    expect(store.saved!.value.hubert.lastDecisionProblem?.message).toMatch(/already answered/);

    provider.push(reply('no-such-message'));
    await controller.step();
    expect(store.saved!.value.hubert.lastDecisionProblem?.message).toMatch(/does not exist/);
    expect(store.saved!.value.hubert.outsideMessages).toHaveLength(1);
  });

  it('offers reply only while an unanswered message exists, and shows messages as data', async () => {
    const provider = scriptedProvider([], { fallback: { type: 'rest' } });
    const { controller, store } = await create(provider);
    await controller.step();
    const types = () => provider.contexts.at(-1)!.choices!.map((choice) => choice.type);
    expect(types()).not.toContain('reply');
    await controller.submitMessage(MESSAGE, { userId: 'ann', displayName: 'Ann' });
    await controller.step();
    const id = idOf(store);
    expect(provider.contexts.at(-1)!.choices).toContainEqual({
      type: 'reply',
      where: { messageId: [id], text: 'any' },
    });
    expect(provider.contexts.at(-1)!.state.messages).toEqual([
      {
        id,
        from: 'Ann',
        at: expect.any(Number),
        text: MESSAGE,
        answered: false,
        canAnswer: true,
      },
    ]);
    provider.push(reply(id));
    await controller.step();
    await controller.step();
    expect(types()).not.toContain('reply');
    expect(provider.contexts.at(-1)!.state.messages).toMatchObject([{ id, answered: true }]);
  });

  it('shows the reply to the account that wrote and to nobody else', async () => {
    const provider = scriptedProvider([], { fallback: { type: 'rest' } });
    const { controller, store } = await create(provider);
    await controller.submitMessage(MESSAGE, { userId: 'ann', displayName: 'Ann' });
    await controller.submitMessage('Someone else wrote this other thing entirely today.', {
      userId: 'bob',
      displayName: 'Bob',
    });
    provider.push(reply(idOf(store, 0)));
    await controller.step();
    expect(controller.listMessages('ann')).toEqual([
      {
        id: idOf(store, 0),
        at: expect.any(Number),
        text: MESSAGE,
        reply: expect.objectContaining({ text: REPLY }),
      },
    ]);
    const bob = JSON.stringify(controller.listMessages('bob'));
    expect(bob).not.toContain(REPLY);
    expect(bob).not.toContain(MESSAGE);
    expect(controller.listMessages('carol')).toEqual([]);
  });

  it('keeps message and reply text out of the public snapshot, trail and events', async () => {
    const provider = scriptedProvider([], { fallback: { type: 'rest' } });
    const { controller, store } = await create(provider);
    await controller.submitMessage(MESSAGE, { userId: 'ann', displayName: 'Ann' });
    provider.push({ action: reply(idOf(store)), why: 'Someone wrote to me and I want to answer.' });
    await controller.step();
    const snapshot = controller.getSnapshot();
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain(MESSAGE);
    expect(text).not.toContain(REPLY);
    expect(text).not.toContain('Ann');
    const entry = snapshot.trail.find((item) => item.kind === 'reply');
    expect(entry).toBeDefined();
    expect(entry!.text).toBeUndefined();
    expect(entry!.url).toBeUndefined();
    expect(JSON.stringify(snapshot.events)).not.toContain(REPLY);
  });

  it('still refuses a public why that repeats the message', async () => {
    const provider = scriptedProvider([], { fallback: { type: 'rest' } });
    const { controller, store } = await create(provider);
    await controller.submitMessage(MESSAGE, { userId: 'ann', displayName: 'Ann' });
    provider.push({ action: reply(idOf(store)), why: MESSAGE });
    await controller.step();
    expect(store.saved!.value.hubert.outsideMessages[0].reply).toBeUndefined();
  });
});
