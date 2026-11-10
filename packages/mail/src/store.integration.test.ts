import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresMailStore } from './store';
import { initialMailState } from './state';
import { VersionConflict } from '../../persistence/src/index';

describe.skipIf(!process.env.TEST_DATABASE_URL)('mail PostgreSQL persistence', () => {
  it('isolates mail from the world, preserves it after reconnect, and rejects stale writers', async () => {
    const base = process.env.TEST_DATABASE_URL!;
    const schema = 'elsewhere_mail_test_' + randomBytes(8).toString('hex');
    const admin = new pg.Pool({ connectionString: base, max: 1 });
    const url = new URL(base);
    url.searchParams.set('options', '-csearch_path=' + schema);
    let first: PostgresMailStore | undefined, second: PostgresMailStore | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      first = new PostgresMailStore(url.href);
      expect(await first.load()).toBeNull();
      const state = initialMailState();
      state.preferences.push({
        characterId: 'hubert',
        userId: 'reader',
        emailHash: 'a'.repeat(64),
        newsletter: true,
        correspondence: false,
      });
      await first.save(state, 0);
      await first.close();
      first = undefined;
      second = new PostgresMailStore(url.href);
      expect(await second.load()).toEqual({ version: 1, value: state });
      await expect(second.save(initialMailState(), 0)).rejects.toBeInstanceOf(VersionConflict);
      expect((await second.load())?.value.preferences).toEqual(state.preferences);
      const worldTable = await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [
        schema,
      ]);
      expect(worldTable.rows.map((row) => row.tablename)).toEqual([
        'elsewhere_character_mail_snapshot',
      ]);
    } finally {
      await first?.close();
      await second?.close();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
