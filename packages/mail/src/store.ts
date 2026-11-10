import pg from 'pg';
import {
  VersionConflict,
  type SnapshotStore,
  type StoredSnapshot,
} from '../../persistence/src/index';
import type { MailState } from './state';

/** Dedicated mail state; never shares the world snapshot table or its version lane. */
export class PostgresMailStore implements SnapshotStore<MailState> {
  private readonly pool: pg.Pool;
  private ready: Promise<unknown> | undefined;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 2,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
      statement_timeout: 10000,
    });
    this.pool.on('error', () => undefined);
  }
  private init() {
    return (this.ready ??= this.pool.query(
      'CREATE TABLE IF NOT EXISTS elsewhere_character_mail_snapshot (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload JSONB NOT NULL)',
    ));
  }
  async load(): Promise<StoredSnapshot<MailState> | null> {
    await this.init();
    const result = await this.pool.query(
      'SELECT version,payload FROM elsewhere_character_mail_snapshot WHERE id=1',
    );
    return result.rows[0]
      ? { version: result.rows[0].version as number, value: result.rows[0].payload as MailState }
      : null;
  }
  async save(value: MailState, expectedVersion: number): Promise<number> {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Locks the empty-table case as well as ordinary CAS updates.
      await client.query('LOCK TABLE elsewhere_character_mail_snapshot IN EXCLUSIVE MODE');
      const result = await client.query(
        'SELECT version FROM elsewhere_character_mail_snapshot WHERE id=1 FOR UPDATE',
      );
      if ((result.rows[0]?.version ?? 0) !== expectedVersion) throw new VersionConflict();
      const next = expectedVersion + 1;
      await client.query(
        'INSERT INTO elsewhere_character_mail_snapshot(id,version,payload) VALUES(1,$1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload',
        [next, JSON.stringify(value)],
      );
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
