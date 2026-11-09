import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresSnapshotStore } from './index';

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL controller ownership', () => {
  it('keeps a paused owner alive and recovers an abandoned session without another writer', async () => {
    const base = process.env.TEST_DATABASE_URL!;
    const schema = `elsewhere_lease_${randomBytes(8).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: base, max: 1 });
    const url = new URL(base);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const abandoned = new pg.Client({ connectionString: url.toString() });
    abandoned.on('error', () => undefined);
    const first = new PostgresSnapshotStore<{ memory: string }>(url.toString(), {
      exclusive: true,
      ownershipIdleTimeoutMs: 1200,
    });
    const second = new PostgresSnapshotStore<{ memory: string }>(url.toString(), {
      exclusive: true,
      ownershipIdleTimeoutMs: 1200,
    });
    let firstClosed = false;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await abandoned.connect();
      await abandoned.query("SET idle_session_timeout = '600ms'");
      await abandoned.query('SELECT pg_advisory_lock(20261109, hashtext(current_schema()))');
      // The external TLS connection may itself take longer than the short fixture timeout.
      await expect.poll(() => first.tryAcquireOwnership(), { timeout: 4000 }).toBe(true);
      await first.init();
      await first.save({ memory: 'a paused life' }, 0);
      // No simulation writes: only the dedicated session heartbeat maintains ownership.
      await new Promise((resolve) => setTimeout(resolve, 1800));
      expect(await second.tryAcquireOwnership()).toBe(false);
      expect((await first.load())?.value.memory).toBe('a paused life');
      await first.close();
      firstClosed = true;
      expect(await second.tryAcquireOwnership()).toBe(true);
      await second.init();
      expect((await second.load())?.value.memory).toBe('a paused life');
    } finally {
      await abandoned.end();
      if (!firstClosed) await first.close();
      await second.close();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  }, 20_000);

  it('hands off the same life and permanently fences a disconnected old process', async () => {
    const base = process.env.TEST_DATABASE_URL!;
    const schema = `elsewhere_owner_${randomBytes(8).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: base, max: 1 });
    const url = new URL(base);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    url.searchParams.set('application_name', schema);
    let lost!: () => void;
    const lostEvent = new Promise<void>((resolve) => {
      lost = resolve;
    });
    const first = new PostgresSnapshotStore<{ memory: string }>(url.toString(), {
      exclusive: true,
      onOwnershipLost: lost,
    });
    const second = new PostgresSnapshotStore<{ memory: string }>(url.toString(), {
      exclusive: true,
    });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      expect(await first.tryAcquireOwnership()).toBe(true);
      await first.init();
      await first.save({ memory: 'kept through deployment' }, 0);
      expect(await second.tryAcquireOwnership()).toBe(false);
      await expect(second.load()).rejects.toThrow('does not own');
      await expect(second.save({ memory: 'unauthorized' }, 1)).rejects.toThrow('does not own');
      const owner = await admin.query(
        "SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=$1 AND l.locktype='advisory' AND l.granted",
        [schema],
      );
      expect(owner.rows).toHaveLength(1);
      await admin.query('SELECT pg_terminate_backend($1)', [owner.rows[0].pid]);
      await lostEvent;
      await expect(first.load()).rejects.toThrow('does not own');
      await expect(first.tryAcquireOwnership()).rejects.toThrow('lost');
      expect(await second.tryAcquireOwnership()).toBe(true);
      await second.init();
      expect((await second.load())?.value).toEqual({ memory: 'kept through deployment' });
      await second.save({ memory: 'new owner continued' }, 1);
      await expect(first.save({ memory: 'stale owner returned' }, 2)).rejects.toThrow(
        'does not own',
      );
      expect((await second.load())?.value.memory).toBe('new owner continued');
    } finally {
      await first.close();
      await second.close();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
