import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCharacterMail } from './character-mail';

const secret = 'whsec_' + Buffer.from('fixture-webhook-secret-with-32-bytes').toString('base64');
const environments = {
  CHARACTER_MAIL_API_KEY: 're_fixture_character_key',
  CHARACTER_MAIL_RECEIVE_API_KEY: 're_fixture_receiving_key',
  CHARACTER_MAIL_UNSUBSCRIBE_SECRET: 'fixture-unsubscribe-secret-with-32-characters',
  CHARACTER_MAIL_WEBHOOK_SECRET: secret,
};
const user = { id: 'owner-1', name: 'Maker', email: 'maker@example.com', emailVerified: true };
const active: Array<Awaited<ReturnType<typeof createCharacterMail>>> = [];
const directories: string[] = [];
afterEach(async () => {
  for (const mail of active.splice(0)) await mail.service.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
async function fixture(receiving: 'pending' | 'enabled' = 'pending') {
  const directory = mkdtempSync(join(tmpdir(), 'elsewhere-mail-orchestration-'));
  directories.push(directory);
  const lookupUserByEmail = vi.fn(async (email: string) => (email === user.email ? user : null));
  const mail = await createCharacterMail(
    { ...environments, CHARACTER_MAIL_RECEIVING: receiving },
    {
      dataDirectory: directory,
      ownerUserId: user.id,
      publicOrigin: 'https://elswhr.dev',
      lookupUser: async (id) => (id === user.id ? user : null),
      lookupUserByEmail,
    },
  );
  active.push(mail);
  return { ...mail, directory, lookupUserByEmail };
}
function event(to = ['hubert@elswhr.dev'], id = 'received-fixture-1') {
  return JSON.stringify({
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: { email_id: id, from: user.email, to, subject: 'A private reply' },
  });
}
function sign(raw: string, eventId = 'msg_fixture_1') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'svix-id': eventId,
    'svix-timestamp': timestamp,
    'svix-signature':
      'v1,' +
      createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
        .update(`${eventId}.${timestamp}.${raw}`)
        .digest('base64'),
  };
}
function stored(directory: string) {
  const db = new DatabaseSync(join(directory, 'character-mail.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT version,payload FROM snapshots WHERE id=1').get();
  } finally {
    db.close();
  }
}
function received(to = ['hubert@elswhr.dev']) {
  return {
    id: 'received-fixture-1',
    from: 'Maker <maker@example.com>',
    to,
    subject: 'A private reply',
    text: 'PRIVATE-MAIL-BODY-CANARY',
    created_at: new Date().toISOString(),
    headers: { 'In-Reply-To': '<fixture-message@example.com>' },
    authentication: { dmarc: 'pass', dkim: 'pass', spf: 'pass' },
  };
}

describe('character mail host orchestration', () => {
  it('rejects an invalid signature before fetching or mutating durable mail state', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const mail = await fixture('enabled');
    const before = stored(mail.directory);
    const raw = event();
    await expect(
      mail.handleWebhook(raw, { ...sign(raw), 'svix-signature': 'v1,invalid' }),
    ).rejects.toThrow('signature');
    expect(fetcher).not.toHaveBeenCalled();
    expect(mail.lookupUserByEmail).not.toHaveBeenCalled();
    expect(stored(mail.directory)).toEqual(before);
  });

  it('keeps receiving pending and does not retrieve even a correctly signed message', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const mail = await fixture('pending');
    const before = stored(mail.directory);
    const raw = event();
    await expect(mail.handleWebhook(raw, sign(raw))).resolves.toMatchObject({
      accepted: false,
      receiving: 'pending',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(stored(mail.directory)).toEqual(before);
    expect(mail.service.getPublic('hubert')?.receiving).toBe('pending');
  });

  it('retrieves a signed enabled recipient privately, normalizes mailbox names, and excludes body from public data', async () => {
    const fetcher = vi.fn(async () => Response.json(received(['Hubert <hubert@elswhr.dev>'])));
    vi.stubGlobal('fetch', fetcher);
    const mail = await fixture('enabled');
    const raw = event(['Hubert <HUBERT@elswhr.dev>']);
    await expect(mail.handleWebhook(raw, sign(raw))).resolves.toMatchObject({ accepted: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe('https://api.resend.com/emails/receiving/received-fixture-1');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer ' + environments.CHARACTER_MAIL_RECEIVE_API_KEY,
    });
    expect(mail.lookupUserByEmail).toHaveBeenCalledWith(user.email);
    const owner = await mail.service.getAccount(user.id, ['hubert']);
    expect(owner[0].owner?.inbox[0]).toMatchObject({
      subject: 'A private reply',
      text: 'PRIVATE-MAIL-BODY-CANARY',
      senderUserId: user.id,
      trust: 'external',
    });
    const visitor = await mail.service.getAccount('visitor-1', []);
    expect(visitor[0]).not.toHaveProperty('owner');
    expect(JSON.stringify(visitor)).not.toContain('PRIVATE-MAIL');
    expect(JSON.stringify(mail.service.getPublic('hubert'))).not.toContain('PRIVATE-MAIL');
    // A provider replay may be fetched again, but never appends a second inbox item.
    await mail.handleWebhook(raw, sign(raw));
    expect((await mail.service.getAccount(user.id, ['hubert']))[0].owner?.inbox).toHaveLength(1);
  });

  it('does not fetch an unknown recipient and rechecks actual retrieved recipients before storing', async () => {
    const fetcher = vi.fn(async () => Response.json(received(['someone-else@elswhr.dev'])));
    vi.stubGlobal('fetch', fetcher);
    const mail = await fixture('enabled');
    const unknown = event(['someone-else@elswhr.dev']);
    await expect(mail.handleWebhook(unknown, sign(unknown))).resolves.toMatchObject({
      accepted: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
    const before = stored(mail.directory);
    const claimsHubert = event();
    await expect(mail.handleWebhook(claimsHubert, sign(claimsHubert))).resolves.toMatchObject({
      accepted: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored(mail.directory)).toEqual(before);
    expect((await mail.service.getAccount(user.id, ['hubert']))[0].owner?.inbox).toEqual([]);
  });

  it('keeps unauthenticated senders external even when their From matches a verified account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...received(),
          authentication: null,
          headers: { 'Authentication-Results': 'dmarc=pass; spf=pass' },
        }),
      ),
    );
    const mail = await fixture('enabled');
    const raw = event();
    await mail.handleWebhook(raw, sign(raw));
    expect(mail.lookupUserByEmail).not.toHaveBeenCalled();
    const inbox = (await mail.service.getAccount(user.id, ['hubert']))[0].owner?.inbox[0];
    expect(inbox).toMatchObject({ senderName: 'External sender', trust: 'external' });
    expect(inbox).not.toHaveProperty('senderUserId');
  });
});
