import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { AccountSummary, PublicSnapshot } from '@elsewhere/character-interfaces';
import {
  createApiServer,
  closeApiServer,
  type ApiDependencies,
  type ApiCharacterMail,
} from '../src/http';
import { createInitialWorld } from '../src/world';
import { MailTransportError } from '../../../packages/mail/src/resend';

const origin = 'https://elswhr.example';
const owner: AccountSummary = {
  id: 'owner',
  name: 'Maker',
  email: 'maker@example.com',
  emailVerified: true,
  role: 'user',
  isWorldAdmin: false,
};
const publicMail = {
  characterId: 'hubert',
  name: 'Hubert',
  address: 'hubert@elswhr.dev',
  receiving: 'pending' as const,
  sendingAvailable: true,
};
const snapshot: PublicSnapshot = {
  world: createInitialWorld(1000),
  character: {
    id: 'hubert',
    name: 'Hubert',
    mood: 60,
    energy: 80,
    boredom: 20,
    frustration: 0,
    socialAppetite: 30,
    activity: 'idle',
    status: 'exploring',
    interests: [],
  },
  events: [],
  memories: [],
  runtime: {
    mode: 'local',
    paused: false,
    tick: 0,
    startedAt: 1000,
    simulatedAt: 1000,
    costUsd: 0,
  },
  mail: publicMail,
};
const active: ReturnType<typeof createApiServer>[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((server) => closeApiServer(server)));
});
function mailFixture(): ApiCharacterMail {
  return {
    getPublic: () => publicMail,
    getAccount: vi.fn(async (_id, managed) => [
      {
        ...publicMail,
        preferences: { newsletter: false, correspondence: false },
        canSubscribe: true,
        ...(managed.includes('hubert')
          ? {
              owner: {
                publication: 'review' as const,
                drafts: [],
                inbox: [],
                deliveries: [],
                subscriberCount: 0,
              },
            }
          : {}),
      },
    ]),
    setPreferences: vi.fn(async (_characterId, _userId, preferences) => preferences),
    compose: vi.fn(async () => ({ id: 'draft-1', status: 'awaiting_approval' })),
    approve: vi.fn(async () => ({ id: 'draft-1', status: 'queued' })),
    unsubscribe: vi.fn(async () => ({ unsubscribed: true })),
  };
}
async function start(overrides: Partial<ApiDependencies> = {}) {
  const mail = mailFixture();
  const server = createApiServer({
    adminToken: 'test-owner-token-with-enough-characters',
    allowedOrigins: [origin],
    getSnapshot: () => snapshot,
    tick: async () => snapshot,
    pause: async () => snapshot,
    resume: async () => snapshot,
    reset: async () => snapshot,
    submitMessage: async () => ({ accepted: true }),
    characterMail: mail,
    auth: {
      handle: async () => undefined,
      getAccount: async () => owner,
      isWorldAdmin: async () => false,
    },
    canManageCharacter: (userId, characterId) => userId === owner.id && characterId === 'hubert',
    ...overrides,
  });
  active.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, mail };
}
const post = (body: unknown, customOrigin = origin): RequestInit => ({
  method: 'POST',
  headers: { Origin: customOrigin, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('character mail HTTP boundary', () => {
  it('publishes only the character address/status and keeps mailbox details in the owner account', async () => {
    const withExtras = {
      ...snapshot,
      mail: { ...publicMail, secret: 'PRIVATE-SECRET', inbox: ['PRIVATE-INBOX'] },
    };
    const { url, mail } = await start({ getSnapshot: () => withExtras });
    const world = await (await fetch(url + '/api/world')).json();
    expect(world.mail).toEqual(publicMail);
    expect(JSON.stringify(world)).not.toContain('PRIVATE-');
    const account = await (await fetch(url + '/api/account')).json();
    expect(account.characterMail[0].owner).toBeDefined();
    expect(mail.getAccount).toHaveBeenCalledWith(owner.id, ['hubert']);
  });
  it('uses the verified signed-in user for independent preferences and rejects spoofed user IDs', async () => {
    const { url, mail } = await start();
    const prefs = { newsletter: true, correspondence: false };
    expect((await fetch(url + '/api/characters/hubert/mail/preferences', post(prefs))).status).toBe(
      200,
    );
    expect(mail.setPreferences).toHaveBeenCalledWith('hubert', owner.id, prefs);
    expect(
      (
        await fetch(
          url + '/api/characters/hubert/mail/preferences',
          post({ ...prefs, userId: 'other' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          url + '/api/characters/hubert/mail/preferences',
          post(prefs, 'https://untrusted.example'),
        )
      ).status,
    ).toBe(403);
    expect((await fetch(url + '/api/characters/other/mail/preferences', post(prefs))).status).toBe(
      404,
    );
    expect(mail.setPreferences).toHaveBeenCalledTimes(1);
  });
  it('rejects unverified and anonymous preference changes', async () => {
    for (const account of [null, { ...owner, emailVerified: false }]) {
      const { url, mail } = await start({
        auth: {
          handle: async () => undefined,
          getAccount: async () => account,
          isWorldAdmin: async () => false,
        },
      });
      expect(
        (
          await fetch(
            url + '/api/characters/hubert/mail/preferences',
            post({ newsletter: true, correspondence: true }),
          )
        ).status,
      ).toBe(account ? 403 : 401);
      expect(mail.setPreferences).not.toHaveBeenCalled();
    }
  });
  it('permits owner drafts and approvals, but world admin status or bootstrap token grants no mailbox authority', async () => {
    const { url, mail } = await start();
    const draft = {
      kind: 'newsletter',
      subject: 'A small discovery',
      text: 'A public observation.',
    };
    expect((await fetch(url + '/api/characters/hubert/mail/drafts', post(draft))).status).toBe(201);
    expect(mail.compose).toHaveBeenCalledWith('hubert', draft, 'owner');
    expect(
      (await fetch(url + '/api/characters/hubert/mail/drafts/draft-1/approve', post({}))).status,
    ).toBe(200);
    expect(mail.approve).toHaveBeenCalledWith('hubert', 'draft-1', owner.id);
    const admin = await start({
      auth: {
        handle: async () => undefined,
        getAccount: async () => ({ ...owner, id: 'platform-admin', isWorldAdmin: true }),
        isWorldAdmin: async () => true,
      },
    });
    expect(
      (
        await fetch(admin.url + '/api/characters/hubert/mail/drafts', {
          ...post(draft),
          headers: {
            ...(post(draft).headers as Record<string, string>),
            Authorization: 'Bearer test-owner-token-with-enough-characters',
          },
        })
      ).status,
    ).toBe(403);
    expect(admin.mail.compose).not.toHaveBeenCalled();
    const account = await (await fetch(admin.url + '/api/account')).json();
    expect(account.characterMail[0].owner).toBeUndefined();
  });
  it('rechecks ownership immediately before an owner draft mutation', async () => {
    let checks = 0;
    const { url, mail } = await start({ canManageCharacter: () => ++checks === 1 });
    expect(
      (
        await fetch(
          url + '/api/characters/hubert/mail/drafts',
          post({ kind: 'maker', subject: 'Question', text: 'Could you help?' }),
        )
      ).status,
    ).toBe(403);
    expect(mail.compose).not.toHaveBeenCalled();
  });
  it('never unsubscribes on GET previews and accepts token-authorized one-click POST without a session', async () => {
    const { url, mail } = await start({ auth: undefined });
    const token = 'a'.repeat(700);
    const path = '/api/mail/unsubscribe?token=' + token;
    const preview = await fetch(url + path);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('<form method="post"');
    expect(mail.unsubscribe).not.toHaveBeenCalled();
    const result = await fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(result.status).toBe(200);
    expect(mail.unsubscribe).toHaveBeenCalledWith(token);
  });
  it('allows only the exact signed webhook callback past proxy ingress and preserves its raw bytes', async () => {
    const raw = '{ "type": "email.received", "data": {"email_id":"mail-1"} }';
    const callback = vi.fn(async (body: string, headers) => {
      if (headers['svix-signature'] !== 'fixture-valid') throw new MailTransportError('signature');
      expect(body).toBe(raw);
    });
    const { url } = await start({
      proxySecret: 'private-proxy-secret-with-more-than-32-characters',
      handleMailWebhook: callback,
    });
    expect((await fetch(url + '/api/world')).status).toBe(403);
    expect(
      (
        await fetch(url + '/api/mail/webhook/resend', {
          method: 'POST',
          headers: { 'svix-signature': 'fixture-valid' },
          body: raw,
        })
      ).status,
    ).toBe(200);
    const rejected = await fetch(url + '/api/mail/webhook/resend', { method: 'POST', body: raw });
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).not.toContain('PRIVATE-');
    expect(
      (await fetch(url + '/api/mail/webhook/resend/other', { method: 'POST', body: raw })).status,
    ).toBe(403);
  });
  it('asks the provider to retry valid webhook processing failures without exposing details', async () => {
    const { url } = await start({
      handleMailWebhook: async () => {
        throw Error('PRIVATE-STORAGE-FAILURE');
      },
    });
    const response = await fetch(url + '/api/mail/webhook/resend', { method: 'POST', body: '{}' });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE-');
  });
  it('rejects oversized webhook bodies before verification or processing', async () => {
    const callback = vi.fn(async () => undefined);
    const { url } = await start({ handleMailWebhook: callback });
    expect(
      (await fetch(url + '/api/mail/webhook/resend', { method: 'POST', body: 'x'.repeat(131073) }))
        .status,
    ).toBe(413);
    expect(callback).not.toHaveBeenCalled();
  });
});

it('requires fresh owner assurance for drafts and approvals, while locked owners can change their own recipient consent', async () => {
  const { url, mail } = await start({
    auth: {
      handle: async () => {},
      getAccount: async () => owner,
      isWorldAdmin: async () => false,
      canUseOwnerControls: async () => false,
    },
  });
  expect(
    (
      await fetch(
        url + '/api/characters/hubert/mail/drafts',
        post({ kind: 'newsletter', subject: 'A note', text: 'Public note' }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await fetch(url + '/api/characters/hubert/mail/drafts/draft-1/approve', post({}))).status,
  ).toBe(403);
  expect(mail.compose).not.toHaveBeenCalled();
  expect(mail.approve).not.toHaveBeenCalled();
  expect(
    (
      await fetch(
        url + '/api/characters/hubert/mail/preferences',
        post({ newsletter: false, correspondence: true }),
      )
    ).status,
  ).toBe(200);
  expect(mail.setPreferences).toHaveBeenCalledWith('hubert', owner.id, {
    newsletter: false,
    correspondence: true,
  });
});

it('rechecks owner assurance after reading the draft body before queuing any external side effect', async () => {
  const assurance = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  const { url, mail } = await start({
    auth: {
      handle: async () => {},
      getAccount: async () => owner,
      isWorldAdmin: async () => false,
      canUseOwnerControls: assurance,
    },
  });
  expect(
    (
      await fetch(
        url + '/api/characters/hubert/mail/drafts',
        post({ kind: 'newsletter', subject: 'A note', text: 'Public note' }),
      )
    ).status,
  ).toBe(403);
  expect(assurance).toHaveBeenCalledTimes(2);
  expect(mail.compose).not.toHaveBeenCalled();
});

it('keeps owner-control admission available while several visitors wait on slow preference changes', async () => {
  const secret = 'fixture-mail-public-proxy-secret'.repeat(2),
    mail = mailFixture();
  let entered = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mail.setPreferences = vi.fn(async (_characterId, _userId, preferences) => {
    entered++;
    await gate;
    return preferences;
  });
  const pause = vi.fn(async () => snapshot);
  const { url } = await start({
    proxySecret: secret,
    characterMail: mail,
    pause,
    auth: {
      handle: async () => {},
      getAccount: async (req) => ({
        ...owner,
        id: String(req.headers['x-fixture-user'] ?? owner.id),
      }),
      isWorldAdmin: async () => false,
    },
    canManageCharacter: (userId) => userId === owner.id,
  });
  const pending = Array.from({ length: 4 }, (_, index) =>
    fetch(url + '/api/characters/hubert/mail/preferences', {
      ...post({ newsletter: true, correspondence: false }),
      headers: {
        ...(post({}).headers as Record<string, string>),
        'x-elsewhere-proxy-token': secret,
        'x-vercel-forwarded-for': '203.0.113.' + (index + 1),
        'x-fixture-user': 'reader-' + index,
      },
    }),
  );
  try {
    await vi.waitFor(() => expect(entered).toBe(4), { timeout: 2000 });
    const response = await fetch(url + '/api/admin/pause', {
      ...post({}),
      headers: {
        ...(post({}).headers as Record<string, string>),
        'x-elsewhere-proxy-token': secret,
        'x-vercel-forwarded-for': '203.0.113.99',
        authorization: 'Bearer test-owner-token-with-enough-characters',
      },
    });
    expect(response.status).toBe(200);
    expect(pause).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await Promise.all(pending);
  }
});

it('keeps sign-in, ownership and passkey recovery visible when optional character-mail projection fails', async () => {
  const mail = mailFixture();
  mail.getAccount = vi.fn(async () => {
    throw Error('PRIVATE-MAIL-STORAGE-DETAILS');
  });
  const { url } = await start({
    characterMail: mail,
    auth: {
      handle: async () => {},
      getAccount: async () => owner,
      isWorldAdmin: async () => false,
      passkeyAuthEnabled: true,
      getSecurityState: async () => ({
        ownerControlsRequirePasskey: true,
        ownerControlsUnlocked: false,
        passkeyVerifiedRecently: false,
      }),
    },
  });
  const response = await fetch(url + '/api/account');
  expect(response.status).toBe(200);
  const value = await response.json();
  expect(value.user).toMatchObject({ id: owner.id });
  expect(value.managedCharacterIds).toEqual(['hubert']);
  expect(value).toMatchObject({
    passkeyAuthEnabled: true,
    ownerControlsRequirePasskey: true,
    ownerControlsUnlocked: false,
    characterMail: [],
    characterMailUnavailable: true,
  });
  expect(JSON.stringify(value)).not.toContain('PRIVATE-MAIL');
});
