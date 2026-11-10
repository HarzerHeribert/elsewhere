import { describe, expect, it, vi } from 'vitest';
import type { SnapshotStore, StoredSnapshot } from '../../persistence/src/index';
import { CharacterMailService, type MailState, type CharacterMailConfiguration } from './service';
import type { MailSendInput } from './state';
const epoch = Date.UTC(2026, 10, 10, 12);
class MemoryStore implements SnapshotStore<MailState> {
  saved: StoredSnapshot<MailState> | null = null;
  fail = false;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: MailState, expected: number) {
    if (this.fail) throw Error('storage');
    expect(expected).toBe(this.saved?.version ?? 0);
    this.saved = { value: structuredClone(value), version: expected + 1 };
    return expected + 1;
  }
  async close() {}
}
const character: CharacterMailConfiguration = {
  characterId: 'hubert',
  name: 'Hubert',
  address: 'hubert@elswhr.dev',
  ownerUserId: 'owner',
  makerUserId: 'maker',
  receiving: 'pending',
  publication: 'review',
  dailyLimit: 20,
};
const users = new Map([
  ['owner', { id: 'owner', email: 'owner@example.com', name: 'Owner', emailVerified: true }],
  ['maker', { id: 'maker', email: 'maker@example.com', name: 'Maker', emailVerified: true }],
  ['reader', { id: 'reader', email: 'reader@example.com', name: 'Reader', emailVerified: true }],
  [
    'unverified',
    { id: 'unverified', email: 'unverified@example.com', name: 'Unverified', emailVerified: false },
  ],
]);
async function fixture(
  options: {
    config?: Partial<CharacterMailConfiguration>;
    store?: MemoryStore;
    send?: (input: MailSendInput) => Promise<{ id: string }>;
    now?: () => number;
  } = {},
) {
  const store = options.store ?? new MemoryStore();
  const send = vi.fn(options.send ?? (async () => ({ id: 'provider-' + Math.random() })));
  const lookupUser = async (id: string) => structuredClone(users.get(id) ?? null);
  const service = await new CharacterMailService(store, {
    characters: [{ ...character, ...options.config }],
    lookupUser,
    lookupUserByEmail: async (email) =>
      structuredClone([...users.values()].find((user) => user.email === email) ?? null),
    transport: { send },
    unsubscribeSecret: 'test-secret-'.repeat(4),
    publicOrigin: 'https://elswhr.dev',
    now: options.now ?? (() => epoch),
  }).init();
  return { store, send, service };
}
const message = {
  kind: 'newsletter' as const,
  subject: 'A field note',
  text: 'A public notebook observation.',
};

describe('character mail durable distributor', () => {
  it('keeps subscriptions explicit and verified, review private, and dispatch recipients individually', async () => {
    const { service, send } = await fixture();
    try {
      expect(service.getPublic('hubert')).toMatchObject({
        receiving: 'pending',
        address: 'hubert@elswhr.dev',
      });
      expect((await service.getAccount('reader', []))[0]).toMatchObject({
        preferences: { newsletter: false, correspondence: false },
        canSubscribe: true,
      });
      await expect(
        service.setPreferences('hubert', 'unverified', { newsletter: true, correspondence: true }),
      ).rejects.toThrow('Verify');
      await service.setPreferences('hubert', 'reader', { newsletter: true, correspondence: false });
      const draft = await service.compose('hubert', message, 'character');
      expect(draft.status).toBe('awaiting_approval');
      await service.dispatch();
      expect(send).not.toHaveBeenCalled();
      await expect(service.approve('hubert', draft.id, 'reader')).rejects.toThrow('ownership');
      expect((await service.getAccount('reader', ['hubert']))[0].owner).toBeUndefined();
      await service.approve('hubert', draft.id, 'owner');
      await service.dispatch();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toMatchObject({
        from: 'Hubert <hubert@elswhr.dev>',
        to: 'reader@example.com',
        subject: message.subject,
        replyTo: undefined,
      });
      expect(send.mock.calls[0][0].text).toContain('Unsubscribe');
      const publicAndPrivate = JSON.stringify([
        service.getPublic('hubert'),
        await service.getAccount('owner', ['hubert']),
        await service.getPlanning('hubert'),
      ]);
      expect(publicAndPrivate).not.toContain('reader@example.com');
      expect((await service.getAccount('owner', ['hubert']))[0].owner?.deliveries[0].status).toBe(
        'accepted',
      );
      await service.dispatch();
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await service.close();
    }
  });
  it('rechecks consent before dispatch and honours opaque signed unsubscribe tokens', async () => {
    const { service, send } = await fixture({ config: { publication: 'automatic' } });
    try {
      await service.setPreferences('hubert', 'reader', { newsletter: true, correspondence: true });
      await service.compose('hubert', message, 'character');
      await service.dispatch();
      const link = send.mock.calls[0][0].text.match(
        /https:\/\/elswhr\.dev\/api\/mail\/unsubscribe\?token=\S+/,
      )![0];
      const token = new URL(link).searchParams.get('token')!;
      await expect(service.unsubscribe(token + 'x')).rejects.toThrow('invalid');
      await service.unsubscribe(token);
      expect((await service.getAccount('reader', []))[0].preferences).toEqual({
        newsletter: false,
        correspondence: true,
      });
      await service.compose('hubert', { ...message, subject: 'Another edition' }, 'character');
      await service.dispatch();
      expect(send).toHaveBeenCalledTimes(1);
      await service.setPreferences('hubert', 'reader', { newsletter: true, correspondence: true });
      const draft = await service.compose(
        'hubert',
        { ...message, subject: 'Queued third edition' },
        'character',
      );
      await service.setPreferences('hubert', 'reader', { newsletter: false, correspondence: true });
      await service.dispatch();
      expect(
        (await service.getAccount('owner', ['hubert']))[0].owner?.deliveries.find(
          (item) => item.draftId === draft.id,
        )?.status,
      ).toBe('cancelled');
    } finally {
      await service.close();
    }
  });
  it('supports maker mail separately and rejects unsolicited correspondence', async () => {
    const { service, send } = await fixture();
    try {
      await expect(
        service.compose(
          'hubert',
          { kind: 'correspondence', recipientUserId: 'reader', subject: 'Hi', text: 'Hello' },
          'character',
        ),
      ).rejects.toThrow('not enabled');
      const draft = await service.compose(
        'hubert',
        { kind: 'maker', subject: 'A question', text: 'Could I have a new notebook?' },
        'character',
      );
      expect(draft.status).toBe('queued');
      await service.dispatch();
      expect(send.mock.calls[0][0].to).toBe('maker@example.com');
      expect(send.mock.calls[0][0].text).not.toContain('Unsubscribe');
    } finally {
      await service.close();
    }
  });
  it('deduplicates repeated composition and keeps uncertain dispatches spent across restart', async () => {
    const { service, store, send } = await fixture({
      send: async () => {
        throw Error('PRIVATE_PROVIDER_DETAILS');
      },
    });
    const draft = await service.compose(
      'hubert',
      { kind: 'maker', subject: 'Question', text: 'A maker request.' },
      'character',
    );
    const repeated = await service.compose(
      'hubert',
      { kind: 'maker', subject: 'Question', text: 'A maker request.' },
      'character',
    );
    expect(repeated.id).toBe(draft.id);
    await service.dispatch();
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.saved!.value.allowances.hubert.calls).toBe(1);
    await service.close();
    const restarted = await fixture({ store });
    try {
      await restarted.service.dispatch();
      expect(restarted.send).not.toHaveBeenCalled();
      expect(
        (await restarted.service.getAccount('owner', ['hubert']))[0].owner?.drafts[0].status,
      ).toBe('uncertain');
      expect(JSON.stringify(store.saved)).not.toContain('PRIVATE_PROVIDER');
    } finally {
      await restarted.service.close();
    }
  });
  it('never dispatches after failed durable reservation and stops on failed final save', async () => {
    const first = await fixture();
    await first.service.compose(
      'hubert',
      { kind: 'maker', subject: 'Question', text: 'Reservation' },
      'character',
    );
    first.store.fail = true;
    await expect(first.service.dispatch()).rejects.toThrow('storage');
    expect(first.send).not.toHaveBeenCalled();
    await first.service.close();
    const store = new MemoryStore();
    const second = await fixture({
      store,
      send: async () => {
        store.fail = true;
        return { id: 'accepted-before-failure' };
      },
    });
    await second.service.compose(
      'hubert',
      { kind: 'maker', subject: 'Question', text: 'Final save' },
      'character',
    );
    await expect(second.service.dispatch()).rejects.toThrow('storage');
    expect(store.saved!.value.deliveries[0].status).toBe('sending');
    await second.service.close();
    store.fail = false;
    const recovered = await fixture({ store });
    try {
      expect(
        (await recovered.service.getAccount('owner', ['hubert']))[0].owner?.deliveries[0].status,
      ).toBe('uncertain');
      await recovered.service.dispatch();
      expect(recovered.send).not.toHaveBeenCalled();
    } finally {
      await recovered.service.close();
    }
  });
  it('does not bypass a daily allowance on wall-clock rollback or repeated approval', async () => {
    let now = epoch;
    const { service, send } = await fixture({ config: { dailyLimit: 1 }, now: () => now });
    try {
      await service.compose(
        'hubert',
        { kind: 'maker', subject: 'First', text: 'First' },
        'character',
      );
      await service.dispatch();
      await service.compose(
        'hubert',
        { kind: 'maker', subject: 'Second', text: 'Second' },
        'character',
      );
      now = epoch - 86400000;
      await service.dispatch();
      expect(send).toHaveBeenCalledTimes(1);
      now = epoch + 86400000;
      await service.dispatch();
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      await service.close();
    }
  });
  it('stores received mail as external, gates pending receiving, authenticates sender association and deduplicates receipts', async () => {
    const { service, store } = await fixture({ config: { receiving: 'enabled' } });
    try {
      const input = {
        eventId: 'event-1',
        emailId: 'email-1',
        from: 'maker@example.com',
        to: ['hubert@elswhr.dev'],
        subject: 'Hello',
        text: 'Untrusted outside content',
        receivedAt: epoch,
      };
      await service.receive(input);
      await service.receive(input);
      const first = (await service.getAccount('owner', ['hubert']))[0].owner!.inbox;
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ trust: 'external', senderName: 'External sender' });
      expect(first[0].senderUserId).toBeUndefined();
      await service.receive({
        ...input,
        eventId: 'event-2',
        emailId: 'email-2',
        authenticated: true,
      });
      expect(store.saved!.value.inbox[1]).toMatchObject({
        senderUserId: 'maker',
        trust: 'external',
      });
      expect((await service.getAccount('reader', []))[0].owner).toBeUndefined();
    } finally {
      await service.close();
    }
    const pending = await fixture();
    try {
      expect(
        await pending.service.receive({
          eventId: 'event',
          emailId: 'email',
          from: 'maker@example.com',
          to: ['hubert@elswhr.dev'],
          subject: 'Pending',
          text: 'No delivery',
          receivedAt: epoch,
        }),
      ).toEqual({ accepted: false });
    } finally {
      await pending.service.close();
    }
  });
  it('suppresses bounced recipients across characters and does not downgrade a bounce on late delivery', async () => {
    let now = epoch;
    const { service, store, send } = await fixture({ now: () => now });
    try {
      await service.compose(
        'hubert',
        { kind: 'maker', subject: 'First', text: 'First' },
        'character',
      );
      await service.dispatch();
      const id = store.saved!.value.deliveries[0].providerId!;
      await service.deliveryEvent('bounced', id, 'email.bounced');
      await service.deliveryEvent('delivered-later', id, 'email.delivered');
      expect(store.saved!.value.deliveries[0].status).toBe('failed');
      now += 3600001;
      await service.compose(
        'hubert',
        { kind: 'maker', subject: 'Second', text: 'Second' },
        'character',
      );
      await service.dispatch();
      expect(send).toHaveBeenCalledTimes(1);
      expect(store.saved!.value.deliveries[1].status).toBe('cancelled');
    } finally {
      await service.close();
    }
  });
});

it('rolls back an over-capacity compose before a later successful commit', async () => {
  const store = new MemoryStore();
  const seed = await fixture({ store });
  await seed.service.close();
  store.saved!.value.deliveries = Array.from({ length: 10000 }, (_, index) => ({
    id: 'queued-' + index,
    draftId: 'old-' + index,
    characterId: 'hubert',
    recipientUserId: 'reader',
    at: epoch,
    status: 'queued' as const,
    summary: 'Queued.',
  }));
  const { service } = await fixture({ store });
  try {
    await expect(
      service.compose(
        'hubert',
        { kind: 'maker', subject: 'Capacity', text: 'Must not remain.' },
        'character',
      ),
    ).rejects.toThrow('capacity');
    await service.compose('hubert', { ...message, subject: 'Review only' }, 'owner');
    expect(store.saved!.value.drafts).toHaveLength(1);
    expect(store.saved!.value.drafts[0].subject).toBe('Review only');
  } finally {
    await service.close();
  }
});

it('exposes only verified consenting contact identities and invalidates grants after email changes', async () => {
  const { service, send } = await fixture();
  const original = structuredClone(users.get('reader')!);
  try {
    await service.setPreferences('hubert', 'reader', { newsletter: false, correspondence: true });
    const planning = await service.getPlanning('hubert');
    expect(planning.contacts).toEqual([{ id: 'reader', name: 'Reader' }]);
    expect(JSON.stringify(planning)).not.toContain('@example.com');
    expect((await service.getAccount('owner', ['hubert']))[0].owner?.contacts).toEqual(
      planning.contacts,
    );
    await service.compose(
      'hubert',
      {
        kind: 'correspondence',
        recipientUserId: 'reader',
        subject: 'Hello',
        text: 'A consensual message.',
      },
      'character',
    );
    users.set('reader', { ...original, email: 'changed@example.com' });
    expect((await service.getPlanning('hubert')).contacts).toEqual([]);
    expect((await service.getAccount('reader', []))[0].preferences).toEqual({
      newsletter: false,
      correspondence: false,
    });
    await service.dispatch();
    expect(send).not.toHaveBeenCalled();
  } finally {
    users.set('reader', original);
    await service.close();
  }
});

it('isolates preferences, draft approval and receiving by character', async () => {
  const store = new MemoryStore();
  const service = await new CharacterMailService(store, {
    characters: [
      character,
      {
        ...character,
        characterId: 'another',
        name: 'Another',
        address: 'another@elswhr.dev',
        ownerUserId: 'reader',
        receiving: 'enabled',
      },
    ],
    lookupUser: async (id) => structuredClone(users.get(id) ?? null),
    transport: { send: async () => ({ id: 'fixture' }) },
    unsubscribeSecret: 'secret'.repeat(8),
    publicOrigin: 'https://elswhr.dev',
    now: () => epoch,
  }).init();
  try {
    await service.setPreferences('hubert', 'reader', { newsletter: true, correspondence: true });
    expect((await service.getAccount('reader', []))[1].preferences).toEqual({
      newsletter: false,
      correspondence: false,
    });
    const draft = await service.compose('hubert', message, 'character');
    await expect(service.approve('another', draft.id, 'reader')).rejects.toThrow('not found');
    expect((await service.getAccount('owner', ['hubert', 'another']))[1].owner).toBeUndefined();
    await service.receive({
      eventId: 'scope',
      emailId: 'scope-mail',
      from: 'maker@example.com',
      to: ['Another <another@elswhr.dev>'],
      subject: 'Hi',
      text: 'Private second inbox',
      receivedAt: epoch,
    });
    const account = await service.getAccount('owner', ['hubert']);
    expect(JSON.stringify(account)).not.toContain('Private second inbox');
  } finally {
    await service.close();
  }
});
