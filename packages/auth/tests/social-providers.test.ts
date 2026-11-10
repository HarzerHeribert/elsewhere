import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage } from 'node:http';
import Database from 'better-sqlite3';
import { createLocalAuth, type LocalAuth } from '../src/index';
import { authOptionsFromEnvironment } from '../src/environment';
import { socialProviderOptions, socialProvidersFromEnvironment } from '../src/social-providers';
const origin = 'http://localhost:5173',
  active: LocalAuth[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(active.splice(0).map((a) => a.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const cookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'elsewhere-social-'));
  dirs.push(dir);
  const auth = await createLocalAuth({
    dataDirectory: dir,
    baseURL: origin,
    trustedOrigins: [origin],
    socialProviders: {
      github: { clientId: 'fixture-github-client', clientSecret: 'fixture-github-secret' },
      google: {
        clientId: 'fixture-google.apps.googleusercontent.com',
        clientSecret: 'fixture-google-secret',
      },
    },
  });
  active.push(auth);
  const post = (path: string, body: unknown, c = '') =>
    auth.webHandler(
      new Request(origin + '/api/auth/' + path, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie: c },
        body: JSON.stringify(body),
      }),
    );
  return { dir, auth, post };
}
it('keeps social sign-in off by default and rejects partial or malformed credential pairs without values in errors', () => {
  expect(socialProvidersFromEnvironment({})).toEqual({});
  expect(authOptionsFromEnvironment({}).socialProviders).toBeUndefined();
  for (const env of [
    { AUTH_GITHUB_CLIENT_ID: 'fixture-id' },
    { AUTH_GOOGLE_CLIENT_SECRET: 'fixture-private-secret' },
    { AUTH_GITHUB_CLIENT_ID: '', AUTH_GITHUB_CLIENT_SECRET: 'fixture-private-secret' },
  ]) {
    try {
      authOptionsFromEnvironment(env);
      throw Error('Expected configuration rejection');
    } catch (error) {
      expect((error as Error).message).not.toMatch(/fixture-private-secret|fixture-id/);
    }
  }
  const options = socialProviderOptions(
    socialProvidersFromEnvironment({
      AUTH_GITHUB_CLIENT_ID: 'fixture-id',
      AUTH_GITHUB_CLIENT_SECRET: 'fixture-secret',
      AUTH_GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
      AUTH_GOOGLE_CLIENT_SECRET: 'fixture-secret',
    }),
  );
  expect(options.github).toMatchObject({
    disableDefaultScope: true,
    scope: ['read:user', 'user:email'],
  });
  expect(options.google).toMatchObject({
    disableDefaultScope: true,
    scope: ['openid', 'email', 'profile'],
    includeGrantedScopes: false,
  });
});
it('generates exact identity-only authorization URLs and refuses caller scope/redirect expansion or token export', async () => {
  const f = await fixture();
  expect(f.auth.socialProviders).toEqual(['github', 'google']);
  for (const [provider, scopes] of [
    ['github', ['read:user', 'user:email']],
    ['google', ['openid', 'email', 'profile']],
  ] as const) {
    const response = await f.post('sign-in/social', {
      provider,
      callbackURL: origin,
      disableRedirect: true,
    });
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    expect(new Set(url.searchParams.get('scope')!.split(' '))).toEqual(new Set(scopes));
    expect(url.searchParams.get('redirect_uri')).toBe(origin + '/api/auth/callback/' + provider);
    expect(url.searchParams.has('include_granted_scopes')).toBe(false);
  }
  for (const body of [
    { provider: 'github', scopes: ['repo'] },
    { provider: 'google', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
    { provider: 'google', additionalParams: { scope: 'drive' } },
    { provider: 'github', callbackURL: 'https://attacker.invalid' },
  ])
    expect((await f.post('sign-in/social', body)).status).toBe(403);
  expect((await f.post('get-access-token', { providerId: 'github' })).status).toBe(403);
  expect((await f.post('refresh-token', { providerId: 'github' })).status).toBe(403);
});
it('refuses implicit same-email linking but explicitly links the signed-in original account and encrypts stored tokens', async () => {
  const f = await fixture(),
    id = await f.auth.createOperatorAccount({ name: 'Owner', email: 'owner@example.invalid' });
  const db = new Database(join(f.dir, 'auth.sqlite'));
  db.prepare('UPDATE elsewhere_auth_user SET emailVerified=1 WHERE id=?').run(id);
  const access = 'fixture-provider-access-token-never-public';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://github.com/login/oauth/access_token')
        return new Response(
          JSON.stringify({
            access_token: access,
            token_type: 'bearer',
            scope: 'read:user user:email',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      if (url === 'https://api.github.com/user')
        return new Response(
          JSON.stringify({
            id: 12345,
            login: 'fixture-owner',
            name: 'Owner',
            email: 'owner@example.invalid',
            avatar_url: 'https://example.invalid/avatar',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      if (url === 'https://api.github.com/user/emails')
        return new Response(
          JSON.stringify([{ email: 'owner@example.invalid', primary: true, verified: true }]),
          { headers: { 'content-type': 'application/json' } },
        );
      throw Error('Unexpected external request in isolated OAuth fixture');
    }),
  );
  const callback = async (initial: Response, existingCookie = '') => {
    const data = await initial.json(),
      authorization = new URL(data.url),
      url = new URL(origin + '/api/auth/callback/github');
    url.searchParams.set('code', 'isolated-fixture-code');
    url.searchParams.set('state', authorization.searchParams.get('state')!);
    return f.auth.webHandler(
      new Request(url, {
        headers: { cookie: [existingCookie, cookie(initial)].filter(Boolean).join('; ') },
      }),
    );
  };
  try {
    const denied = await callback(
      await f.post('sign-in/social', {
        provider: 'github',
        callbackURL: origin,
        disableRedirect: true,
      }),
    );
    expect(denied.status).toBe(302);
    expect(denied.headers.get('location')).toContain('account_not_linked');
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM elsewhere_auth_account WHERE providerId='github'")
          .get() as { n: number }
      ).n,
    ).toBe(0);
    const link = await f.auth.issueOperatorSignIn(id),
      token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('sign-in');
    const signed = await f.post('one-time-token/verify', { token }),
      ownerCookie = cookie(signed);
    const linked = await callback(
      await f.post('link-social', { provider: 'github', callbackURL: origin }, ownerCookie),
      ownerCookie,
    );
    expect(linked.status).toBe(302);
    const account = await f.auth.getAccount({
      headers: { cookie: ownerCookie },
    } as IncomingMessage);
    expect(account).toMatchObject({ id, isWorldAdmin: true });
    expect(
      await f.auth.getLinkedSocialProviders({
        headers: { cookie: ownerCookie },
      } as IncomingMessage),
    ).toEqual(['github']);
    const row = db
      .prepare("SELECT userId,accessToken FROM elsewhere_auth_account WHERE providerId='github'")
      .get() as { userId: string; accessToken: string };
    expect(row.userId).toBe(id);
    expect(row.accessToken).toBeTruthy();
    expect(row.accessToken).not.toContain(access);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM elsewhere_auth_user').get() as { n: number }).n,
    ).toBe(1);
    expect(JSON.stringify({ providers: f.auth.socialProviders, account })).not.toContain(access);
    // An already linked identity can still sign in without a passkey; its owner controls stay locked.
    db.prepare('UPDATE elsewhere_auth_user SET ownerControlsRequirePasskey=1 WHERE id=?').run(id);
    const ordinary = await callback(
      await f.post('sign-in/social', {
        provider: 'github',
        callbackURL: origin,
        disableRedirect: true,
      }),
    );
    expect(ordinary.status).toBe(302);
    expect(ordinary.headers.get('location')).not.toContain('error=');
    const ordinaryRequest = { headers: { cookie: cookie(ordinary) } } as IncomingMessage;
    expect(await f.auth.getAccount(ordinaryRequest)).toMatchObject({ id, isWorldAdmin: true });
    expect(await f.auth.getSecurityState(ordinaryRequest)).toMatchObject({
      ownerControlsRequirePasskey: true,
      ownerControlsUnlocked: false,
    });
  } finally {
    db.close();
  }
});

it('does not finish an old weak-session link after passkey protection is enabled, even when its session cookie is omitted', async () => {
  const f = await fixture(),
    id = await f.auth.createOperatorAccount({ name: 'Owner', email: 'owner@example.invalid' });
  const db = new Database(join(f.dir, 'auth.sqlite'));
  db.prepare('UPDATE elsewhere_auth_user SET emailVerified=1 WHERE id=?').run(id);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://github.com/login/oauth/access_token')
        return new Response(
          JSON.stringify({
            access_token: 'fixture-pending-link-token',
            token_type: 'bearer',
            scope: 'read:user user:email',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      if (url === 'https://api.github.com/user')
        return new Response(
          JSON.stringify({
            id: 12345,
            login: 'fixture-owner',
            name: 'Owner',
            email: 'owner@example.invalid',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      if (url === 'https://api.github.com/user/emails')
        return new Response(
          JSON.stringify([{ email: 'owner@example.invalid', primary: true, verified: true }]),
          { headers: { 'content-type': 'application/json' } },
        );
      throw Error('Unexpected external request in pending-link fixture');
    }),
  );
  try {
    const link = await f.auth.issueOperatorSignIn(id),
      token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('sign-in');
    const signed = await f.post('one-time-token/verify', { token }),
      ownerCookie = cookie(signed);
    const pending = await f.post(
      'link-social',
      { provider: 'github', callbackURL: origin },
      ownerCookie,
    );
    expect(pending.status).toBe(200);
    const authorization = new URL((await pending.json()).url);
    // Another device enabled the durable requirement after this old weak link began.
    db.prepare('UPDATE elsewhere_auth_user SET ownerControlsRequirePasskey=1 WHERE id=?').run(id);
    const url = new URL(origin + '/api/auth/callback/github');
    url.searchParams.set('code', 'isolated-pending-code');
    url.searchParams.set('state', authorization.searchParams.get('state')!);
    const callback = await f.auth.webHandler(
      new Request(url, { headers: { cookie: cookie(pending) } }),
    );
    expect([302, 403]).toContain(callback.status);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM elsewhere_auth_account WHERE providerId='github'")
          .get() as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (await f.auth.getSecurityState({ headers: { cookie: ownerCookie } } as IncomingMessage))
        ?.ownerControlsRequirePasskey,
    ).toBe(true);
    // A new explicit link with a current, same-account verified passkey session is allowed.
    db.prepare('UPDATE elsewhere_auth_session SET authMethod=?,authTime=? WHERE userId=?').run(
      'passkey',
      Date.now(),
      id,
    );
    const fresh = await f.post(
      'link-social',
      { provider: 'github', callbackURL: origin },
      ownerCookie,
    );
    expect(fresh.status).toBe(200);
    const freshUrl = new URL(origin + '/api/auth/callback/github');
    freshUrl.searchParams.set('code', 'isolated-fresh-code');
    freshUrl.searchParams.set(
      'state',
      new URL((await fresh.json()).url).searchParams.get('state')!,
    );
    const linked = await f.auth.webHandler(
      new Request(freshUrl, { headers: { cookie: ownerCookie + '; ' + cookie(fresh) } }),
    );
    expect(linked.status).toBe(302);
    expect(linked.headers.get('location')).not.toContain('error=');
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM elsewhere_auth_account WHERE providerId='github'")
          .get() as { n: number }
      ).n,
    ).toBe(1);
  } finally {
    db.close();
  }
});
