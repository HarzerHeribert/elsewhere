import { expect, it, vi } from 'vitest';
import { verificationSenderFromEnvironment } from '../src/verification-mail';
import { createLocalAuth } from '../src/index';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = {
  WEB_ORIGIN: 'https://elsewhere.example',
  AUTH_EMAIL_FROM: 'accounts@example.com',
  AUTH_EMAIL_API_KEY: 're_fixture_account_key',
};
it('keeps verification off until both dedicated account-mail settings are supplied', () => {
  expect(verificationSenderFromEnvironment({})).toBeUndefined();
  expect(() =>
    verificationSenderFromEnvironment({ AUTH_EMAIL_FROM: env.AUTH_EMAIL_FROM }),
  ).toThrow();
  expect(() =>
    verificationSenderFromEnvironment({ AUTH_EMAIL_API_KEY: env.AUTH_EMAIL_API_KEY }),
  ).toThrow();
});
it('sends only the bounded verification message with a stable retry key and no private identity content', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));
  const send = verificationSenderFromEnvironment(env, fetcher)!;
  const request = {
    email: 'visitor@example.com',
    name: '<untrusted name>',
    url: 'https://elsewhere.example/api/auth/verify-email?token=fixture-token',
  };
  await send(request);
  await send(request);
  expect(fetcher.mock.calls).toHaveLength(2);
  const call = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0];
  expect(call[0]).toBe('https://api.resend.com/emails');
  expect(call[1].redirect).toBe('error');
  expect(call[1].signal).toBeInstanceOf(AbortSignal);
  const body = JSON.parse(call[1].body as string);
  expect(body.to).toEqual([request.email]);
  expect(body.from).toBe(env.AUTH_EMAIL_FROM);
  expect(body.text).toContain(request.url);
  expect(body.text).not.toContain(request.name);
  const headers = call[1].headers as Record<string, string>;
  expect(headers['idempotency-key']).toBe(
    (
      (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[1][1].headers as Record<
        string,
        string
      >
    )['idempotency-key'],
  );
});
it('rejects injected verification destinations and redacts provider response errors', async () => {
  const fetcher = vi.fn(
    async () => new Response('fixture-provider-secret-detail', { status: 400 }),
  );
  const send = verificationSenderFromEnvironment(env, fetcher)!;
  await expect(
    send({
      email: 'visitor@example.com',
      name: '',
      url: 'https://attacker.example/api/auth/verify-email?token=fixture',
    }),
  ).rejects.toThrow('Invalid');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    send({
      email: 'visitor@example.com',
      name: '',
      url: 'https://elsewhere.example/api/auth/verify-email?token=fixture',
    }),
  ).rejects.toThrow('Verification delivery failed.');
});

it('uses actual Better Auth verification links to unlock production email sign-in', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'elsewhere-verification-'));
  let delivered = '';
  const send = verificationSenderFromEnvironment(env, async (_url, init) => {
    delivered = JSON.parse(init!.body as string).text;
    return new Response('{}');
  });
  const auth = await createLocalAuth({
    dataDirectory: directory,
    baseURL: env.WEB_ORIGIN,
    trustedOrigins: [env.WEB_ORIGIN],
    production: true,
    secret: 'fixture-auth-signing-'.repeat(3),
    sendVerificationEmail: send,
  });
  const post = (path: string, body: unknown) =>
    auth.webHandler(
      new Request(env.WEB_ORIGIN + '/api/auth/' + path, {
        method: 'POST',
        headers: { origin: env.WEB_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const credentials = {
    email: 'fixture-visitor@example.com',
    password: 'Fixture-verification-password-82!',
  };
  try {
    expect((await post('sign-up/email', { ...credentials, name: 'Fixture visitor' })).status).toBe(
      200,
    );
    expect(delivered).toContain('/api/auth/verify-email?');
    expect((await post('sign-in/email', credentials)).status).toBe(403);
    const link = delivered.split('\n').find((line) => line.startsWith(env.WEB_ORIGIN))!;
    const verified = await auth.webHandler(
      new Request(link, { headers: { origin: env.WEB_ORIGIN } }),
    );
    expect([200, 302]).toContain(verified.status);
    const login = await post('sign-in/email', credentials);
    expect(login.status).toBe(200);
    expect(login.headers.getSetCookie().join(';')).toContain('Secure');
    expect((await login.json()).user.emailVerified).toBe(true);
  } finally {
    await auth.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
