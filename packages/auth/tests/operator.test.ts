import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import Database from 'better-sqlite3';
import { createLocalAuth, type LocalAuth } from '../src/index';

const origin = 'https://operator-fixture.invalid';
const active = new Set<LocalAuth>();
const directories: string[] = [];
const options = (directory: string) => ({
  dataDirectory: directory,
  baseURL: origin,
  trustedOrigins: [origin],
  production: true,
  secret: 'operator-fixture-only-auth-secret-at-least-32-characters',
});
async function create(directory?: string) {
  const root = directory ?? mkdtempSync(join(tmpdir(), 'elsewhere-operator-test-'));
  if (!directory) directories.push(root);
  const auth = await createLocalAuth(options(root));
  active.add(auth);
  return { auth, directory: root };
}
const request = (auth: LocalAuth, token: string, from = origin) =>
  auth.webHandler(
    new Request(`${origin}/api/auth/one-time-token/verify`, {
      method: 'POST',
      headers: { origin: from, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  );
const nodeRequest = (response: Response) =>
  ({
    headers: {
      cookie: response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    },
  }) as IncomingMessage;
const issue = async (auth: LocalAuth) => {
  const userId = await auth.createOperatorAccount({
    name: 'Fixture owner',
    email: 'operator@example.invalid',
  });
  const link = await auth.issueOperatorSignIn(userId);
  return {
    userId,
    link,
    token: new URLSearchParams(new URL(link.url).hash.slice(1)).get('sign-in')!,
  };
};
afterEach(async () => {
  for (const auth of active) await auth.close();
  active.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('private operator sign-in', () => {
  it('keeps public password signup and privileged account/token creation closed', async () => {
    const { auth } = await create();
    expect(auth.passwordAuthEnabled).toBe(false);
    for (const path of ['admin/create-user', 'one-time-token/generate']) {
      const response = await auth.webHandler(
        new Request(`${origin}/api/auth/${path}`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'attacker@example.invalid',
            name: 'Attacker',
            role: 'admin',
          }),
        }),
      );
      expect(response.status).toBe(403);
    }
    const signup = await auth.webHandler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Visitor',
          email: 'visitor@example.invalid',
          password: 'fixture-only-long-password-2026',
        }),
      }),
    );
    expect(signup.status).toBe(400);
    expect(signup.headers.has('set-cookie')).toBe(false);
  });

  it('consumes an opaque hashed link once and issues an ordinary private, unverified-email operator session', async () => {
    const { auth, directory } = await create();
    const { userId, link, token } = await issue(auth);
    expect(new URL(link.url).search).toBe('');
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    const db = new Database(join(directory, 'auth.sqlite'), { readonly: true });
    const rows = db.prepare('SELECT identifier FROM elsewhere_auth_verification').all();
    db.close();
    expect(JSON.stringify(rows)).not.toContain(token);
    const responses = await Promise.all([request(auth, token), request(auth, token)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const accepted = responses.find((response) => response.status === 200)!;
    expect(await accepted.json()).toEqual({ ok: true });
    const cookie = accepted.headers.getSetCookie().join(';');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(await auth.getAccount(nodeRequest(accepted))).toMatchObject({
      id: userId,
      role: 'admin',
      emailVerified: false,
    });
    expect(
      (
        await auth.webHandler(
          new Request(`${origin}/api/auth/one-time-token/generate`, {
            headers: { origin, cookie: nodeRequest(accepted).headers.cookie as string },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('rejects foreign origins without consuming the intended owner link', async () => {
    const { auth } = await create();
    const { token } = await issue(auth);
    expect((await request(auth, token, 'https://foreign.invalid')).status).toBe(403);
    expect((await request(auth, token)).status).toBe(200);
  });

  it('expires links, survives restart, and respects subsequent admin revocation', async () => {
    const { auth, directory } = await create();
    const { userId, token } = await issue(auth);
    const db = new Database(join(directory, 'auth.sqlite'));
    db.prepare('UPDATE elsewhere_auth_verification SET expiresAt=?').run(Date.now() - 1000);
    db.close();
    expect((await request(auth, token)).status).toBe(400);
    const fresh = await auth.issueOperatorSignIn(userId);
    await auth.close();
    active.delete(auth);
    const { auth: reopened } = await create(directory);
    const accepted = await request(
      reopened,
      new URLSearchParams(new URL(fresh.url).hash.slice(1)).get('sign-in')!,
    );
    expect(accepted.status).toBe(200);
    await reopened.setWorldAdmin(userId, false);
    expect(await reopened.isWorldAdmin(nodeRequest(accepted))).toBe(false);
    await expect(reopened.issueOperatorSignIn(userId)).rejects.toThrow('operator account');
    await expect(reopened.issueOperatorSignIn('missing')).rejects.toThrow('operator account');
  });
});
