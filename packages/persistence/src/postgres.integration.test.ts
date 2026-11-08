import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresSnapshotStore, VersionConflict } from './index';

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL adapter integration', () => {
  it('preserves snapshots across connections and rejects stale commits atomically', async () => {
    const base = process.env.TEST_DATABASE_URL!;
    const schema = `elsewhere_test_${randomBytes(8).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: base, max: 1 });
    const url = new URL(base);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    let first: PostgresSnapshotStore<{ memory: string }> | undefined;
    let second: PostgresSnapshotStore<{ memory: string }> | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      first = new PostgresSnapshotStore(url.toString());
      await first.init();
      expect(await first.load()).toBeNull();
      await first.save({ memory: 'a place worth returning to' }, 0);
      await first.close();
      first = undefined;
      second = new PostgresSnapshotStore(url.toString());
      await second.init();
      expect(await second.load()).toEqual({
        version: 1,
        value: { memory: 'a place worth returning to' },
      });
      await expect(second.save({ memory: 'stale writer' }, 0)).rejects.toBeInstanceOf(
        VersionConflict,
      );
      expect((await second.load())?.value.memory).toBe('a place worth returning to');
      await second.save({ memory: 'a new observation' }, 1);
      expect((await second.load())?.version).toBe(2);
    } finally {
      await first?.close();
      await second?.close();
      // Only this test's randomly named schema is removed; no existing app tables are touched.
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
