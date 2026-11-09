import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage } from 'node:http';
import Database from 'better-sqlite3';
import { createLocalAuth, type LocalAuth } from '../src/index';
const origin = 'https://www.elswhr.dev';
const active: LocalAuth[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((a) => a.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'elsewhere-passkey-security-'));
  dirs.push(dir);
  const auth = await createLocalAuth({
    dataDirectory: dir,
    baseURL: origin,
    trustedOrigins: [origin],
    production: true,
    secret: 'isolated-passkey-test-secret-'.repeat(3),
  });
  active.push(auth);
  const userId = await auth.createOperatorAccount({
    name: 'Owner',
    email: 'owner@example.invalid',
  });
  const post = (path: string, body: unknown, cookie = '', from = origin) =>
    auth.webHandler(
      new Request(origin + '/api/auth/' + path, {
        method: 'POST',
        headers: { origin: from, 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
    );
  const get = (path: string, cookie = '') =>
    auth.webHandler(new Request(origin + '/api/auth/' + path, { headers: { cookie } }));
  const signIn = async () => {
    const link = await auth.issueOperatorSignIn(userId);
    const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('sign-in');
    const r = await post('one-time-token/verify', { token });
    expect(r.status).toBe(200);
    return r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  };
  return { dir, auth, userId, post, get, signIn };
}
const req = (cookie: string) => ({ headers: { cookie } }) as IncomingMessage;
it('requires a signed-in account to enroll and pins the production origin/RP with mandatory user verification', async () => {
  const f = await fixture();
  expect(f.auth.passkeyAuthEnabled).toBe(true);
  expect((await f.get('passkey/generate-register-options')).status).toBe(401);
  const cookie = await f.signIn();
  const response = await f.get('passkey/generate-register-options', cookie);
  expect(response.status).toBe(200);
  const options = await response.json();
  expect(options.rp.id).toBe('elswhr.dev');
  expect(options.authenticatorSelection).toMatchObject({
    residentKey: 'required',
    userVerification: 'required',
  });
  expect(
    (
      await f.post(
        'passkey/verify-registration',
        { response: {} },
        cookie,
        'https://attacker.invalid',
      )
    ).status,
  ).toBe(403);
  expect(await f.auth.getAccount(req(cookie))).toMatchObject({ id: f.userId, isWorldAdmin: true });
});
it('requires explicit opt-in after a fresh trusted passkey login, then blocks email/operator sessions until passkey step-up', async () => {
  const f = await fixture(),
    strongCookie = await f.signIn(),
    weakCookie = await f.signIn();
  expect(await f.auth.getSecurityState(req(strongCookie))).toMatchObject({
    ownerControlsRequirePasskey: false,
    ownerControlsUnlocked: true,
    passkeyVerifiedRecently: false,
  });
  expect((await f.post('security/owner-passkey', { required: true }, strongCookie)).status).toBe(
    403,
  );
  expect(
    (
      await f.post(
        'security/owner-passkey',
        { required: true, authMethod: 'passkey', authTime: Date.now() },
        strongCookie,
      )
    ).status,
  ).toBe(400);
  await f.post(
    'update-user',
    { ownerControlsRequirePasskey: true, authMethod: 'passkey', authTime: Date.now() },
    strongCookie,
  );
  expect((await f.auth.getSecurityState(req(strongCookie)))?.ownerControlsRequirePasskey).toBe(
    false,
  );
  // Trusted database fixture simulates a completed ceremony; browser tests verify actual WebAuthn.
  const db = new Database(join(f.dir, 'auth.sqlite'));
  try {
    db.prepare(
      'INSERT INTO elsewhere_auth_passkey(id,name,publicKey,userId,credentialID,counter,deviceType,backedUp,createdAt) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(
      'fixture-key',
      'Device',
      'fixture-public-key',
      f.userId,
      'fixture-credential',
      0,
      'singleDevice',
      0,
      Date.now(),
    );
    const first = db
      .prepare('SELECT id FROM elsewhere_auth_session WHERE userId=? ORDER BY rowid ASC LIMIT 1')
      .get(f.userId) as { id: string };
    db.prepare('UPDATE elsewhere_auth_session SET authMethod=?,authTime=? WHERE id=?').run(
      'passkey',
      Date.now(),
      first.id,
    );
    expect((await f.post('security/owner-passkey', { required: true }, strongCookie)).status).toBe(
      200,
    );
    expect(await f.auth.getSecurityState(req(weakCookie))).toMatchObject({
      ownerControlsRequirePasskey: true,
      ownerControlsUnlocked: false,
      passkeyVerifiedRecently: false,
    });
    expect(await f.auth.canUseOwnerControls(req(weakCookie))).toBe(false);
    for (const path of [
      'passkey/verify-registration',
      'passkey/delete-passkey',
      'passkey/update-passkey',
      'link-social',
      'unlink-account',
      'change-password',
      'set-password',
      'change-email',
      'update-user',
      'delete-user',
    ])
      expect((await f.post(path, {}, weakCookie)).status, path).toBe(403);
    expect((await f.get('passkey/generate-register-options', weakCookie)).status).toBe(403);
    expect(
      (await f.post('passkey/delete-passkey', { id: 'fixture-key' }, strongCookie)).status,
    ).toBe(403);
    expect(await f.auth.canUseOwnerControls(req(strongCookie))).toBe(true);
    db.prepare('UPDATE elsewhere_auth_session SET authTime=? WHERE id=?').run(
      Date.now() - 6 * 60000,
      first.id,
    );
    expect(await f.auth.canUseOwnerControls(req(strongCookie))).toBe(false);
    expect((await f.post('security/owner-passkey', { required: false }, strongCookie)).status).toBe(
      403,
    );
    db.prepare('UPDATE elsewhere_auth_session SET authTime=? WHERE id=?').run(Date.now(), first.id);
    expect((await f.post('security/owner-passkey', { required: false }, strongCookie)).status).toBe(
      200,
    );
    expect(await f.auth.canUseOwnerControls(req(weakCookie))).toBe(true);
    expect(await f.auth.getAccount(req(weakCookie))).toMatchObject({
      id: f.userId,
      isWorldAdmin: true,
    });
  } finally {
    db.close();
  }
});
