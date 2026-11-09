import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { AuthMailBudget } from '../src/mail-budget';
const connectionString = process.env.TEST_AUTH_DATABASE_URL;
describe.runIf(Boolean(connectionString))('durable PostgreSQL auth-email admission', () => {
  it('serializes competing reservations across two instances and preserves limits on reopening', async () => {
    const schema = 'elsewhere_mail_test_' + randomUUID().replaceAll('-', '');
    const admin = new pg.Pool({ connectionString, max: 1 });
    let pool: pg.Pool | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const url = new URL(connectionString!);
      url.searchParams.set('options', `-c search_path=${schema}`);
      pool = new pg.Pool({
        connectionString: url.href,
        max: 4,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
      });
      const first = new AuthMailBudget({ pool }, 'fixture-mail-secret', { maxPerDay: 5 }),
        second = new AuthMailBudget({ pool }, 'fixture-mail-secret', { maxPerDay: 5 });
      await Promise.all([first.init(), second.init()]);
      const attempts = await Promise.all(
        Array.from({ length: 16 }, (_, i) =>
          (i % 2 ? first : second).reserve(`person${i}@example.invalid`),
        ),
      );
      expect(attempts.filter(Boolean)).toHaveLength(5);
      const reopened = new AuthMailBudget({ pool }, 'fixture-mail-secret', { maxPerDay: 5 });
      await reopened.init();
      expect(await reopened.reserve('another@example.invalid')).toBe(false);
      const rows = await pool.query('SELECT * FROM elsewhere_auth_mail_budget');
      expect(rows.rows).toHaveLength(1);
      expect(JSON.stringify(rows.rows)).not.toMatch(/person|example|token/i);
    } finally {
      await pool?.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  }, 15000);
});
