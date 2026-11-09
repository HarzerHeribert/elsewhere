import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import pg from 'pg';
import { createLocalAuth, type LocalAuth } from '../src/index';

const connectionString = process.env.TEST_AUTH_DATABASE_URL;
const origin = 'http://127.0.0.1:5173';
const password = 'Isolated-Postgres-Test-Password-82!';
const asNodeRequest = (cookie: string) => ({ headers: { cookie } }) as IncomingMessage;
const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

/** Opt-in only: the supplied database must permit creating a temporary test schema. */
describe.runIf(Boolean(connectionString))('Better Auth PostgreSQL portability', () => {
  it('migrates an isolated schema and preserves real accounts, sessions and role changes across restart', async () => {
    const schema = `elsewhere_auth_test_${randomUUID().replaceAll('-', '')}`;
    if (!/^elsewhere_auth_test_[a-f0-9]{32}$/.test(schema))
      throw new Error('Unsafe test schema identifier');
    const admin = new pg.Pool({ connectionString, max: 1 });
    const directory = mkdtempSync(join(tmpdir(), 'elsewhere-auth-postgres-'));
    const active = new Set<LocalAuth>();
    let created = false;
    try {
      // Never reset a database or touch public: only this randomly named schema is writable.
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const scoped = new URL(connectionString!);
      scoped.searchParams.set('options', `-c search_path=${schema}`);
      const options = {
        dataDirectory: directory,
        baseURL: origin,
        trustedOrigins: [origin],
        databaseUrl: scoped.toString(),
      };
      const first = await createLocalAuth(options);
      active.add(first);
      const signup = await first.webHandler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Postgres resident',
            email: 'postgres-resident@example.com',
            password,
          }),
        }),
      );
      expect(signup.status).toBe(200);
      const signupData = await signup.json();
      expect(signupData.user.role).toBe('user');
      const login = await first.webHandler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'postgres-resident@example.com', password }),
        }),
      );
      expect(login.status).toBe(200);
      const cookie = cookiesFrom(login);
      expect(cookie).toBeTruthy();
      expect(await first.isWorldAdmin(asNodeRequest(cookie))).toBe(false);
      await first.setWorldAdmin(signupData.user.id);
      expect(await first.isWorldAdmin(asNodeRequest(cookie))).toBe(true);
      expect((await first.getAccount(asNodeRequest(cookie)))?.role).toBe('admin');
      const secret = readFileSync(join(directory, 'auth-secret'), 'utf8');
      await first.close();
      active.delete(first);

      const reopened = await createLocalAuth(options);
      active.add(reopened);
      expect(readFileSync(join(directory, 'auth-secret'), 'utf8')).toBe(secret);
      expect((await reopened.getAccount(asNodeRequest(cookie)))?.id).toBe(signupData.user.id);
      expect(await reopened.isWorldAdmin(asNodeRequest(cookie))).toBe(true);
      await reopened.setWorldAdmin(signupData.user.id, false);
      expect(await reopened.isWorldAdmin(asNodeRequest(cookie))).toBe(false);
      expect((await reopened.getAccount(asNodeRequest(cookie)))?.role).toBe('user');
      const operatorId = await reopened.createOperatorAccount({
        name: 'Operator fixture',
        email: 'operator-fixture@example.invalid',
      });
      const link = await reopened.issueOperatorSignIn(operatorId);
      const oneTime = new URLSearchParams(new URL(link.url).hash.slice(1)).get('sign-in');
      const claims = await Promise.all(
        [0, 1].map(() =>
          reopened.webHandler(
            new Request(`${origin}/api/auth/one-time-token/verify`, {
              method: 'POST',
              headers: { origin, 'content-type': 'application/json' },
              body: JSON.stringify({ token: oneTime }),
            }),
          ),
        ),
      );
      expect(claims.map((response) => response.status).sort()).toEqual([200, 400]);
      expect(
        await reopened.getAccount(
          asNodeRequest(cookiesFrom(claims.find((response) => response.status === 200)!)),
        ),
      ).toMatchObject({ id: operatorId, emailVerified: false, isWorldAdmin: true });
      const tables = await admin.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema=$1',
        [schema],
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          'elsewhere_auth_user',
          'elsewhere_auth_session',
          'elsewhere_auth_account',
          'elsewhere_auth_verification',
        ]),
      );
    } finally {
      // Cleanup must still drop the test schema if one adapter's close reports an error.
      await Promise.allSettled([...active].map((auth) => auth.close()));
      try {
        if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }, 30_000);
});
