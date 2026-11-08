import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createLocalAuth, type LocalAuth, type LocalAuthOptions } from '../src/index';

const origin = 'http://127.0.0.1:5173';
const password = 'A-long-local-test-password-91!';
const roots: string[] = [];
const active = new Set<LocalAuth>();
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'elsewhere-auth-'));
  roots.push(path);
  return path;
}
async function create(options: Partial<LocalAuthOptions> = {}) {
  const dataDirectory = options.dataDirectory ?? directory();
  const auth = await createLocalAuth({
    dataDirectory,
    baseURL: origin,
    trustedOrigins: [origin],
    ...options,
  });
  active.add(auth);
  return { auth, dataDirectory };
}
async function close(auth: LocalAuth) {
  active.delete(auth);
  await auth.close();
}
function nodeRequest(cookie?: string) {
  return { headers: cookie ? { cookie } : {} } as IncomingMessage;
}
async function request(
  auth: LocalAuth,
  path: string,
  body?: unknown,
  cookie?: string,
  from = origin,
) {
  return auth.webHandler(
    new Request(`${origin}/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: from,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
async function signup(auth: LocalAuth, email = 'resident@example.com') {
  const response = await request(auth, 'sign-up/email', { name: 'A resident', email, password });
  expect(response.status).toBe(200);
  const data = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(cookie).toBeTruthy();
  return { cookie, data, response };
}
afterEach(async () => {
  for (const auth of active) await auth.close();
  active.clear();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('real Better Auth accounts', () => {
  it('creates a normal account with signed HttpOnly cookies and never makes the first signup admin', async () => {
    const { auth } = await create();
    expect(await auth.getAccount(nodeRequest())).toBeNull();
    expect(await auth.isWorldAdmin(nodeRequest())).toBe(false);
    const { response, cookie, data } = await signup(auth);
    expect(data.user.role).toBe('user');
    expect(data.user.emailVerified).toBe(false);
    expect(response.headers.getSetCookie()[0].toLowerCase()).toContain('httponly');
    expect(response.headers.getSetCookie()[0].toLowerCase()).toContain('samesite=lax');
    expect(await auth.getAccount(nodeRequest(cookie))).toEqual({
      id: data.user.id,
      name: 'A resident',
      email: 'resident@example.com',
      emailVerified: false,
      role: 'user',
      isWorldAdmin: false,
    });
    expect(await auth.isWorldAdmin(nodeRequest(cookie))).toBe(false);
    expect(JSON.stringify(data)).not.toContain(password);
  });

  it('rejects role injection and unprivileged admin operations', async () => {
    const { auth } = await create();
    const forged = await request(auth, 'sign-up/email', {
      name: 'Forged',
      email: 'forged@example.com',
      password,
      role: 'admin',
    });
    expect(forged.status).toBe(400);
    const { cookie, data } = await signup(auth);
    const escalation = await request(
      auth,
      'admin/set-role',
      { userId: data.user.id, role: 'admin' },
      cookie,
    );
    expect([401, 403]).toContain(escalation.status);
    const update = await request(auth, 'update-user', { role: 'admin' }, cookie);
    expect(update.status).toBeGreaterThanOrEqual(400);
    expect(await auth.isWorldAdmin(nodeRequest(cookie))).toBe(false);
  });

  it('requires an explicit out-of-band grant and reads revocation immediately', async () => {
    const { auth } = await create();
    const { cookie, data } = await signup(auth);
    await auth.setWorldAdmin(data.user.id);
    expect(await auth.isWorldAdmin(nodeRequest(cookie))).toBe(true);
    expect((await auth.getAccount(nodeRequest(cookie)))?.role).toBe('admin');
    await auth.setWorldAdmin(data.user.id, false);
    expect(await auth.isWorldAdmin(nodeRequest(cookie))).toBe(false);
    await expect(auth.setWorldAdmin('not-an-account')).rejects.toThrow(/not found/);
  });

  it('does not give world admins account impersonation or role-assignment HTTP powers', async () => {
    const { auth } = await create();
    const admin = await signup(auth, 'world-admin@example.com');
    const resident = await signup(auth, 'other-resident@example.com');
    await auth.setWorldAdmin(admin.data.user.id);
    expect(await auth.isWorldAdmin(nodeRequest(admin.cookie))).toBe(true);
    for (const path of ['admin/impersonate-user', 'admin/set-role', '%61dmin/set-role']) {
      const response = await request(
        auth,
        path,
        { userId: resident.data.user.id, role: 'admin' },
        admin.cookie,
      );
      expect(response.status).toBe(403);
    }
    expect(await auth.isWorldAdmin(nodeRequest(resident.cookie))).toBe(false);
  });

  it('preserves sessions, accounts and the private signing secret after reopening', async () => {
    const { auth, dataDirectory } = await create();
    const { cookie, data } = await signup(auth);
    await auth.setWorldAdmin(data.user.id);
    const secret = readFileSync(join(dataDirectory, 'auth-secret'), 'utf8');
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(statSync(join(dataDirectory, 'auth-secret')).mode & 0o777).toBe(0o600);
    await close(auth);
    const { auth: reopened } = await create({ dataDirectory });
    expect(readFileSync(join(dataDirectory, 'auth-secret'), 'utf8')).toBe(secret);
    expect((await reopened.getAccount(nodeRequest(cookie)))?.id).toBe(data.user.id);
    expect(await reopened.isWorldAdmin(nodeRequest(cookie))).toBe(true);
  });

  it('signs in with the stored password and invalidates the session on signout', async () => {
    const { auth } = await create();
    const { cookie } = await signup(auth);
    const wrong = await request(auth, 'sign-in/email', {
      email: 'resident@example.com',
      password: 'Wrong-but-long-password!',
    });
    expect(wrong.status).toBe(401);
    const login = await request(auth, 'sign-in/email', { email: 'resident@example.com', password });
    expect(login.status).toBe(200);
    const logout = await request(auth, 'sign-out', {}, cookie);
    expect(logout.status).toBe(200);
    expect(await auth.getAccount(nodeRequest(cookie))).toBeNull();
  });

  it('rejects cross-origin signup and session mutation', async () => {
    const { auth } = await create();
    const signupAttempt = await request(
      auth,
      'sign-up/email',
      { name: 'Untrusted', email: 'cross@example.com', password },
      undefined,
      'https://attacker.example',
    );
    expect(signupAttempt.status).toBe(403);
    const { cookie } = await signup(auth);
    const logoutAttempt = await request(auth, 'sign-out', {}, cookie, 'https://attacker.example');
    expect(logoutAttempt.status).toBe(403);
    expect(await auth.getAccount(nodeRequest(cookie))).not.toBeNull();
  });

  it('disables public password auth until production email verification delivery is configured', async () => {
    const { auth } = await create({
      production: true,
      secret: 'test-only-production-secret-0123456789-abcdef',
      baseURL: 'https://elsewhere.example',
      trustedOrigins: ['https://elsewhere.example'],
    });
    expect(auth.passwordAuthEnabled).toBe(false);
    expect(auth.requiresEmailVerification).toBe(true);
    const response = await auth.webHandler(
      new Request('https://elsewhere.example/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' },
        body: JSON.stringify({ name: 'Resident', email: 'resident@example.com', password }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('bounds request bodies and requires trusted-origin JSON for account changes', async () => {
    const { auth } = await create();
    const oversized = await request(auth, 'sign-up/email', {
      name: 'x'.repeat(70_000),
      email: 'large@example.com',
      password,
    });
    expect(oversized.status).toBe(413);
    const noOrigin = await auth.webHandler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'A name', email: 'origin@example.com', password }),
      }),
    );
    expect(noOrigin.status).toBe(403);
  });

  it('rejects insecure production origins and undersized supplied secrets', async () => {
    await expect(create({ production: true })).rejects.toThrow(/HTTPS/);
    await expect(
      create({ production: true, baseURL: 'https://elsewhere.example' }),
    ).rejects.toThrow(/explicit BETTER_AUTH_SECRET/);
    await expect(create({ secret: 'too-short' })).rejects.toThrow(/32 characters/);
  });
});
