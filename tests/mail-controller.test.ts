import { describe, expect, it, vi } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import { CharacterMailService, type MailState } from '../packages/mail/src/service';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';

class MemoryStore<T> implements SnapshotStore<T> {
  saved: StoredSnapshot<T> | null = null;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: T, expected: number) {
    expect(expected).toBe(this.saved?.version ?? 0);
    this.saved = { value: structuredClone(value), version: expected + 1 };
    return expected + 1;
  }
  async close() {}
}
const epoch = Date.UTC(2026, 10, 10, 12);
async function fixture() {
  const world = new MemoryStore<ControllerState>();
  const first = await new ElsewhereController(world, { now: () => epoch }).init();
  await first.close();
  world.saved!.value.hubert.notebook = {
    day: '2026-11-10',
    calls: 0,
    lastAtReal: epoch,
    latestAtReal: epoch,
    sourceIds: [],
    entries: [
      {
        id: 'public-note',
        at: epoch,
        text: 'I wonder why the crooked fin catches on the axle.',
        sourceIds: ['receipt'],
      },
    ],
  };
  world.saved!.value.hubert.outsideMessages = [
    { id: 'private', source: 'visitor', text: 'PRIVATE-VISITOR-CANARY', at: epoch },
  ];
  const send = vi.fn(async (_input: import('../packages/mail/src/state').MailSendInput) => ({
    id: 'provider-receipt',
  }));
  const mail = await new CharacterMailService(new MemoryStore<MailState>(), {
    characters: [
      {
        characterId: 'hubert',
        name: 'Hubert',
        address: 'hubert@elswhr.dev',
        ownerUserId: 'owner',
        makerUserId: 'maker',
        receiving: 'pending',
        publication: 'review',
        dailyLimit: 5,
      },
    ],
    lookupUser: async (id) =>
      ['owner', 'reader', 'maker'].includes(id)
        ? { id, email: id + '@example.com', name: id, emailVerified: true }
        : null,
    transport: { send },
    unsubscribeSecret: 'mail-test-secret-'.repeat(3),
    publicOrigin: 'https://elswhr.dev',
    now: () => epoch,
  }).init();
  return { world, mail, send };
}
describe('mail in the character decision loop', () => {
  it('keeps real decisions available when optional mail planning fails, without leaking or charging a fictitious failed model call', async () => {
    const { world, mail } = await fixture();
    vi.spyOn(mail, 'getPlanning').mockRejectedValueOnce(new Error('PRIVATE-MAIL-ERROR-CANARY'));
    const propose = vi.fn(async (context) => {
      expect(context.state.mail).toEqual({ available: false });
      return { type: 'rest', durationMs: 30000 };
    });
    const controller = await new ElsewhereController(world, {
      now: () => epoch,
      mail,
      modelProvider: { id: 'fixture', propose },
    }).init();
    try {
      await controller.step();
      expect(propose).toHaveBeenCalledOnce();
      expect(world.saved!.value.modelAllowance.calls).toBe(1);
      expect(controller.getSnapshot().runtime.modelStatus).toBe('Model connected');
      expect(controller.getCharacterIssues()).toEqual([]);
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('PRIVATE-MAIL-ERROR-CANARY');
    } finally {
      await controller.close();
      await mail.close();
    }
  });

  it('drafts an edition solely from public entries, awaits owner review, and never claims delivery from drafting', async () => {
    const { world, mail, send } = await fixture();
    await mail.setPreferences('hubert', 'reader', { newsletter: true, correspondence: false });
    const propose = vi.fn(async (context) => {
      expect(context.state.mail.publicEntries).toEqual([
        { id: 'public-note', text: 'I wonder why the crooked fin catches on the axle.' },
      ]);
      expect(JSON.stringify(context.state.mail)).not.toContain('@example.com');
      return { type: 'draft_mail', kind: 'newsletter', entryIds: ['public-note'] };
    });
    const controller = await new ElsewhereController(world, {
      now: () => epoch,
      mail,
      modelProvider: { id: 'fixture', propose },
    }).init();
    try {
      await controller.step();
      await mail.dispatch();
      expect(send).not.toHaveBeenCalled();
      const account = (await mail.getAccount('owner', ['hubert']))[0];
      const draft = account.owner!.drafts[0];
      expect(draft.status).toBe('awaiting_approval');
      expect(draft.text).not.toContain('PRIVATE-');
      expect(world.saved!.value.hubert.lastOutcome?.summary).toContain('awaiting owner review');
      await controller.step();
      expect((await mail.getAccount('owner', ['hubert']))[0].owner!.drafts).toHaveLength(1);
      await mail.approve('hubert', draft.id, 'owner');
      await mail.dispatch();
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][0].text).not.toContain('PRIVATE-');
      const publicText = JSON.stringify(controller.getSnapshot());
      expect(publicText).not.toContain('reader@example.com');
      expect(publicText).not.toContain(draft.id);
      expect(controller.getSnapshot().mail?.receiving).toBe('pending');
    } finally {
      await controller.close();
      await mail.close();
    }
  });
  it('rejects invented source entries without creating mail or a fictional delivery', async () => {
    const { world, mail, send } = await fixture();
    const controller = await new ElsewhereController(world, {
      now: () => epoch,
      mail,
      modelProvider: {
        id: 'fixture',
        propose: async () => ({ type: 'draft_mail', kind: 'maker', entryIds: ['private'] }),
      },
    }).init();
    try {
      await controller.step();
      await mail.dispatch();
      expect(world.saved!.value.hubert.lastOutcome?.status).toBe('rejected');
      expect((await mail.getAccount('owner', ['hubert']))[0].owner!.drafts).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    } finally {
      await controller.close();
      await mail.close();
    }
  });
});
