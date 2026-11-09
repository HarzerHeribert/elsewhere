import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { createLocalAuth, type LocalAuth } from '../src/index';
import { mutateCredentialPolicy } from '../src/credential-policy';
const connectionString = process.env.TEST_AUTH_DATABASE_URL;
describe.runIf(Boolean(connectionString))('PostgreSQL owner credential invariants', () => {
  it('atomically prevents deletion of the final key and races with explicit opt-in across instances', async () => {
    const schema = 'elsewhere_keys_test_' + randomUUID().replaceAll('-', ''),
      directory = mkdtempSync(join(tmpdir(), 'elsewhere-keys-pg-'));
    const admin = new pg.Pool({ connectionString, max: 1 });
    let pool: pg.Pool | undefined, auth: LocalAuth | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const scoped = new URL(connectionString!);
      scoped.searchParams.set('options', `-c search_path=${schema}`);
      auth = await createLocalAuth({
        dataDirectory: directory,
        baseURL: 'http://localhost:5173',
        trustedOrigins: ['http://localhost:5173'],
        databaseUrl: scoped.href,
      });
      const id = await auth.createOperatorAccount({
        name: 'Owner',
        email: 'owner@example.invalid',
      });
      pool = new pg.Pool({ connectionString: scoped.href, max: 4 });
      for (const key of ['one', 'two'])
        await pool.query(
          'INSERT INTO elsewhere_auth_passkey(id,name,"publicKey","userId","credentialID",counter,"deviceType","backedUp","createdAt") VALUES($1,$1,$1,$2,$1,0,$3,false,NOW())',
          [key, id, 'singleDevice'],
        );
      await mutateCredentialPolicy({ pool }, id, { type: 'policy', required: true }, true);
      const deletes = await Promise.allSettled(
        ['one', 'two'].map((key) =>
          mutateCredentialPolicy({ pool }, id, { type: 'delete', id: key }, true),
        ),
      );
      expect(deletes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        Number((await pool.query('SELECT COUNT(*) AS n FROM elsewhere_auth_passkey')).rows[0].n),
      ).toBe(1);
      await mutateCredentialPolicy({ pool }, id, { type: 'policy', required: false }, true);
      const key = (await pool.query('SELECT id FROM elsewhere_auth_passkey')).rows[0].id;
      const toggles = await Promise.allSettled([
        mutateCredentialPolicy({ pool }, id, { type: 'policy', required: true }, true),
        mutateCredentialPolicy({ pool }, id, { type: 'delete', id: key }, true),
      ]);
      expect(toggles.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const user = (
        await pool.query(
          'SELECT "ownerControlsRequirePasskey" AS required FROM elsewhere_auth_user WHERE id=$1',
          [id],
        )
      ).rows[0];
      const n = Number(
        (await pool.query('SELECT COUNT(*) AS n FROM elsewhere_auth_passkey')).rows[0].n,
      );
      expect(user.required && n === 0).toBe(false);
    } finally {
      await auth?.close();
      await pool?.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }, 20000);
});
