import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import Database from 'better-sqlite3';
import { createLocalAuth, type LocalAuth } from '../src/index';
import { signInSenderFromEnvironment } from '../src/verification-mail';

const origin = 'https://email-login-fixture.invalid';
const active = new Set<LocalAuth>();
const directories: string[] = [];
afterEach(async () => {
  for (const auth of active) await auth.close();
  active.clear();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'elsewhere-email-login-'));
  directories.push(directory);
  const links: string[] = [];
  const auth = await createLocalAuth({
    dataDirectory: directory,
    baseURL: origin,
    trustedOrigins: [origin],
    production: true,
    secret: 'fixture-email-login-secret-'.repeat(3),
    sendVerificationEmail: async () => {},
    sendSignInEmail: async ({ url }) => {
      links.push(url);
    },
  });
  active.add(auth);
  const post = (path: string, body: unknown, from = origin) =>
    auth.webHandler(
      new Request(origin + '/api/auth/' + path, {
        method: 'POST',
        headers: { origin: from, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  return { auth, directory, links, post };
}
const cookieRequest = (r: Response) =>
  ({
    headers: {
      cookie: r.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    },
  }) as IncomingMessage;

it('signs the existing passwordless owner in, proves their email, and consumes a hashed one-use link', async () => {
  const f = await fixture();
  const owner = await f.auth.createOperatorAccount({
    name: 'Owner',
    email: 'owner@example.invalid',
  });
  expect(f.auth.emailLinkAuthEnabled).toBe(true);
  expect(
    (await f.post('sign-in/magic-link', { email: 'owner@example.invalid', callbackURL: origin }))
      .status,
  ).toBe(200);
  expect(f.links).toHaveLength(1);
  const token = new URL(f.links[0]).searchParams.get('token')!;
  const db = new Database(join(f.directory, 'auth.sqlite'), { readonly: true });
  try {
    expect(
      JSON.stringify(db.prepare('SELECT * FROM elsewhere_auth_verification').all()),
    ).not.toContain(token);
  } finally {
    db.close();
  }
  const verified = await f.auth.webHandler(new Request(f.links[0]));
  expect([200, 302]).toContain(verified.status);
  expect(verified.headers.getSetCookie().join(';')).toMatch(/Secure/);
  const account = await f.auth.getAccount(cookieRequest(verified));
  expect(account).toMatchObject({ id: owner, emailVerified: true, isWorldAdmin: true });
  const replay = await f.auth.webHandler(new Request(f.links[0]));
  expect(await f.auth.getAccount(cookieRequest(replay))).toBeNull();
});

it('does not accept an operator recovery token as an email link or silently create an account', async () => {
  const f = await fixture();
  const owner = await f.auth.createOperatorAccount({
    name: 'Owner',
    email: 'owner@example.invalid',
  });
  const operator = await f.auth.issueOperatorSignIn(owner);
  const token = new URLSearchParams(new URL(operator.url).hash.slice(1)).get('sign-in')!;
  const wrong = await f.auth.webHandler(
    new Request(origin + '/api/auth/magic-link/verify?token=' + encodeURIComponent(token)),
  );
  expect(await f.auth.getAccount(cookieRequest(wrong))).toBeNull();
  await f.post('sign-in/magic-link', { email: 'stranger@example.invalid', callbackURL: origin });
  if (f.links.length) {
    const result = await f.auth.webHandler(new Request(f.links.at(-1)!));
    expect(await f.auth.getAccount(cookieRequest(result))).toBeNull();
  }
  const db = new Database(join(f.directory, 'auth.sqlite'), { readonly: true });
  try {
    expect(db.prepare('SELECT COUNT(*) AS n FROM elsewhere_auth_user').get()).toMatchObject({
      n: 1,
    });
  } finally {
    db.close();
  }
});

it('rejects untrusted origins and off-site callbacks before delivering sign-in links', async () => {
  const f = await fixture();
  const body = { email: 'owner@example.invalid', callbackURL: origin };
  expect((await f.post('sign-in/magic-link', body, 'https://attacker.invalid')).status).toBe(403);
  expect(
    (await f.post('sign-in/magic-link', { ...body, callbackURL: 'https://attacker.invalid' }))
      .status,
  ).toBe(403);
  expect(f.links).toHaveLength(0);
});

it('uses the dedicated mail sender only for same-origin authentication links', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));
  const send = signInSenderFromEnvironment(
    {
      WEB_ORIGIN: origin,
      AUTH_EMAIL_FROM: 'accounts@auth.example.invalid',
      AUTH_EMAIL_API_KEY: 're_fixture_only_key',
    },
    fetcher,
  )!;
  await expect(
    send({
      email: 'owner@example.invalid',
      url: 'https://attacker.invalid/api/auth/magic-link/verify?token=x',
    }),
  ).rejects.toThrow('Invalid');
  expect(fetcher).not.toHaveBeenCalled();
  await send({
    email: 'owner@example.invalid',
    url: origin + '/api/auth/magic-link/verify?token=fixture',
  });
  const init = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
  const body = JSON.parse(init.body as string);
  expect(body.subject).toBe('Sign in to Elsewhere');
  expect(body.text).toContain('\n\n' + origin);
  expect(body.to).toEqual(['owner@example.invalid']);
});

it('never exposes an authenticated session token when a link is redeemed without a redirect', async () => {
  const f = await fixture();
  const owner = await f.auth.createOperatorAccount({
    name: 'Owner',
    email: 'owner@example.invalid',
  });
  await f.post('sign-in/magic-link', { email: 'owner@example.invalid', callbackURL: origin });
  const url = new URL(f.links[0]);
  for (const key of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'])
    url.searchParams.delete(key);
  const response = await f.auth.webHandler(new Request(url));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await f.auth.getAccount(cookieRequest(response))).toMatchObject({
    id: owner,
    emailVerified: true,
  });
});
