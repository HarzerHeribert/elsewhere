import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ResendMailTransport, verifyResendWebhook } from './resend';
import { characterMailFromEnvironment } from './config';

const epoch = Date.UTC(2026, 10, 10, 12);
const secret = 'whsec_' + Buffer.from('fixture-webhook-secret-with-32-bytes').toString('base64');
const env = {
  CHARACTER_MAIL_API_KEY: 're_fixture_character_key',
  CHARACTER_MAIL_UNSUBSCRIBE_SECRET: 'fixture-unsubscribe-secret-with-32-characters',
  HUBERT_OWNER_USER_ID: 'owner-1',
  WEB_ORIGIN: 'https://elswhr.dev',
};
const outgoing = {
  from: 'Hubert <hubert@elswhr.dev>',
  to: 'reader@example.com',
  subject: 'A note from the courtyard',
  text: 'The fin still wobbles.',
  replyTo: 'hubert@elswhr.dev',
  idempotencyKey: 'character-mail-fixture-message-1',
};
function signed(raw: string, seconds = Math.floor(epoch / 1000)) {
  const id = 'msg_fixture_1';
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`${id}.${seconds}.${raw}`)
    .digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(seconds), 'svix-signature': 'v1,' + signature };
}
const received = {
  id: 'received-fixture-1',
  from: 'Maker <maker@example.com>',
  to: ['Hubert <hubert@elswhr.dev>'],
  subject: 'A reply',
  text: 'Try a shorter axle.',
  created_at: new Date(epoch).toISOString(),
  headers: { 'In-Reply-To': '<message@example.com>' },
  authentication: { dmarc: 'pass', spf: 'pass', dkim: 'pass' },
};

describe('character Resend transport', () => {
  it('uses a fixed API, separate key, one recipient and durable idempotency key', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 'sent-fixture-1' }));
    const transport = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, { fetcher });
    await expect(
      transport.send({
        ...outgoing,
        headers: { 'List-Unsubscribe': '<https://elswhr.dev/api/mail/unsubscribe?token=fixture>' },
      }),
    ).resolves.toEqual({ id: 'sent-fixture-1' });
    const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      authorization: 'Bearer ' + env.CHARACTER_MAIL_API_KEY,
      'idempotency-key': outgoing.idempotencyKey,
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: outgoing.from,
      to: [outgoing.to],
      reply_to: outgoing.replyTo,
      subject: outgoing.subject,
      text: outgoing.text,
    });
  });
  it('rejects header injection and arbitrary headers before network access', async () => {
    const fetcher = vi.fn();
    const transport = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, { fetcher });
    await expect(
      transport.send({ ...outgoing, subject: 'Hello\r\nBcc: another@example.com' }),
    ).rejects.toThrow('input');
    await expect(
      transport.send({ ...outgoing, headers: { authorization: 'secret' } }),
    ).rejects.toThrow('input');
    await expect(transport.send({ ...outgoing, headers: { References: 'a\nb' } })).rejects.toThrow(
      'input',
    );
    await expect(
      transport.send({ ...outgoing, to: 'reader@example.com,another@example.com' }),
    ).rejects.toThrow('input');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds provider payloads and redacts failures without automatic retries', async () => {
    const failure = vi.fn(async () => new Response('PRIVATE-PROVIDER-RESPONSE', { status: 403 }));
    const transport = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, { fetcher: failure });
    await expect(transport.send(outgoing)).rejects.toThrow('unavailable');
    expect(failure).toHaveBeenCalledTimes(1);
    const overflow = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, {
      fetcher: async () => new Response('x'.repeat(262145)),
    });
    await expect(overflow.send(outgoing)).rejects.toThrow('response');
    const bad = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, {
      fetcher: async () => Response.json({ id: 'https://unsafe.example' }),
    });
    await expect(bad.send(outgoing)).rejects.toThrow('response');
  });
  it('retrieves bounded plain text and uses server-computed sender authentication', async () => {
    const fetcher = vi.fn(async () => Response.json(received));
    const transport = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, { fetcher });
    await expect(transport.retrieveReceived(received.id)).resolves.toMatchObject({
      id: received.id,
      from: 'maker@example.com',
      to: ['hubert@elswhr.dev'],
      text: received.text,
      inReplyTo: '<message@example.com>',
      authenticated: true,
    });
    expect((fetcher.mock.calls as unknown as [string][])[0][0]).toBe(
      'https://api.resend.com/emails/receiving/' + received.id,
    );
    await expect(transport.retrieveReceived('../emails')).rejects.toThrow('input');
    const spoof = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, {
      fetcher: async () =>
        Response.json({
          ...received,
          authentication: { dmarc: 'fail', spf: 'pass', dkim: 'pass' },
          headers: { 'authentication-results': 'dmarc=pass' },
        }),
    });
    expect((await spoof.retrieveReceived(received.id)).authenticated).toBe(false);
    const noText = new ResendMailTransport(env.CHARACTER_MAIL_API_KEY, {
      fetcher: async () =>
        Response.json({
          ...received,
          text: null,
          html: '<script>unsafe</script>',
          authentication: null,
        }),
    });
    const result = await noText.retrieveReceived(received.id);
    expect(result.text).toContain('no plain-text body');
    expect(result.text).not.toContain('<script>');
    expect(result.authenticated).toBe(false);
  });
});

describe('verified Resend webhook boundary', () => {
  const raw = JSON.stringify({
    type: 'email.received',
    created_at: new Date(epoch).toISOString(),
    data: {
      email_id: received.id,
      from: received.from,
      to: received.to,
      subject: received.subject,
      privateField: 'not projected',
    },
  });
  it('verifies exact bytes and projects only allowed event fields', () => {
    const event = verifyResendWebhook(raw, signed(raw), secret, epoch);
    expect(event).toMatchObject({
      eventId: 'msg_fixture_1',
      emailId: received.id,
      type: 'email.received',
      createdAt: epoch,
    });
    expect(event).not.toHaveProperty('privateField');
    expect(() => verifyResendWebhook(raw + ' ', signed(raw), secret, epoch)).toThrow('signature');
  });
  it('supports rotated signatures but rejects stale/future/unsigned or malformed requests', () => {
    const headers = signed(raw);
    expect(
      verifyResendWebhook(
        raw,
        { ...headers, 'svix-signature': 'v0,old ' + headers['svix-signature'] },
        secret,
        epoch,
      ).emailId,
    ).toBe(received.id);
    expect(() => verifyResendWebhook(raw, signed(raw, epoch / 1000 - 301), secret, epoch)).toThrow(
      'signature',
    );
    expect(() => verifyResendWebhook(raw, signed(raw, epoch / 1000 + 301), secret, epoch)).toThrow(
      'signature',
    );
    expect(() => verifyResendWebhook(raw, {}, secret, epoch)).toThrow('signature');
    expect(() => verifyResendWebhook(raw, headers, 'not-a-key', epoch)).toThrow('signature');
    expect(() =>
      verifyResendWebhook(raw, { ...headers, 'svix-signature': 'v1,bad' }, secret, epoch),
    ).toThrow('signature');
    const invalid = '{bad json';
    expect(() => verifyResendWebhook(invalid, signed(invalid), secret, epoch)).toThrow('signature');
  });
  it.each(['email.delivered', 'email.bounced', 'email.complained'] as const)(
    'accepts signed %s delivery events',
    (type) => {
      const body = JSON.stringify({
        type,
        created_at: new Date(epoch).toISOString(),
        data: { email_id: 'sent-fixture-1' },
      });
      expect(verifyResendWebhook(body, signed(body), secret, epoch).type).toBe(type);
    },
  );
});

describe('private character mail configuration', () => {
  it('keeps character sending off without its own key and receiving pending by default', () => {
    expect(
      characterMailFromEnvironment({ AUTH_EMAIL_API_KEY: 're_account_only_key' }),
    ).toBeUndefined();
    const config = characterMailFromEnvironment(env)!;
    expect(config.characters[0]).toMatchObject({
      characterId: 'hubert',
      address: 'hubert@elswhr.dev',
      receiving: 'pending',
      publication: 'review',
      dailyLimit: 20,
    });
    expect(config.characters[0].makerUserId).toBeUndefined();
    expect(config.webhookSecret).toBeUndefined();
    expect(config.publicOrigin).toBe('https://elswhr.dev');
  });
  it('requires explicit maker binding, signed webhook activation, separate key and HTTPS hosted origin', () => {
    expect(() =>
      characterMailFromEnvironment({ ...env, CHARACTER_MAIL_RECEIVING: 'enabled' }),
    ).toThrow('configuration');
    expect(() =>
      characterMailFromEnvironment({ ...env, AUTH_EMAIL_API_KEY: env.CHARACTER_MAIL_API_KEY }),
    ).toThrow('configuration');
    expect(() =>
      characterMailFromEnvironment({ ...env, CHARACTER_MAIL_UNSUBSCRIBE_SECRET: 'short' }),
    ).toThrow('configuration');
    expect(() =>
      characterMailFromEnvironment({ ...env, WEB_ORIGIN: 'https://user:secret@elswhr.dev' }),
    ).toThrow('configuration');
    expect(() =>
      characterMailFromEnvironment({
        ...env,
        WEB_ORIGIN: 'http://elswhr.dev',
        NODE_ENV: 'production',
      }),
    ).toThrow('configuration');
    const config = characterMailFromEnvironment({
      ...env,
      CHARACTER_MAIL_RECEIVING: 'enabled',
      CHARACTER_MAIL_RECEIVE_API_KEY: 're_fixture_receiving_key',
      CHARACTER_MAIL_WEBHOOK_SECRET: secret,
      CHARACTER_MAIL_MAKER_USER_ID: 'maker-1',
    })!;
    expect(config.characters[0]).toMatchObject({ makerUserId: 'maker-1', receiving: 'enabled' });
  });
});
