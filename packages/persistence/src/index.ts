import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

export interface StoredSnapshot<T> {
  version: number;
  value: T;
}
export interface SnapshotStore<T> {
  load(): Promise<StoredSnapshot<T> | null>;
  save(value: T, expectedVersion: number): Promise<number>;
  close(): Promise<void>;
}

export class VersionConflict extends Error {
  constructor() {
    super('State changed in another controller. Stop duplicate controllers before restarting.');
  }
}

/** Local adapter. A state commit and its audit record are atomic. */
export class SqliteSnapshotStore<T> implements SnapshotStore<T> {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commits (version INTEGER PRIMARY KEY, committed_at TEXT NOT NULL);
    `);
  }
  async load(): Promise<StoredSnapshot<T> | null> {
    const row = this.db.prepare('SELECT version, payload FROM snapshots WHERE id=1').get() as
      | { version: number; payload: string }
      | undefined;
    return row ? { version: row.version, value: JSON.parse(row.payload) as T } : null;
  }
  async save(value: T, expectedVersion: number): Promise<number> {
    const next = expectedVersion + 1;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT version FROM snapshots WHERE id=1').get() as
        | { version: number }
        | undefined;
      if ((row?.version ?? 0) !== expectedVersion) throw new VersionConflict();
      this.db
        .prepare(
          'INSERT INTO snapshots(id,version,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload',
        )
        .run(next, JSON.stringify(value));
      this.db
        .prepare('INSERT INTO commits(version,committed_at) VALUES(?,?)')
        .run(next, new Date().toISOString());
      this.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async close() {
    this.db.close();
  }
}

/** Same snapshot contract on standard PostgreSQL. No cloud-specific persistence APIs. */
export class PostgresSnapshotStore<T> implements SnapshotStore<T> {
  private readonly pool: pg.Pool;
  private owner?: pg.PoolClient;
  private ownershipLost = false;
  private closing = false;
  constructor(
    url: string,
    private readonly options: { exclusive?: boolean; onOwnershipLost?: () => void } = {},
  ) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 10_000,
      query_timeout: 15_000,
    });
    this.pool.on('error', () => {
      /* Idle clients are discarded by pg; held clients have their own loss handler. */
    });
  }
  /** A session lock and all fenced state I/O share the SAME connection. Never reconnect a lost owner. */
  async tryAcquireOwnership(): Promise<boolean> {
    if (!this.options.exclusive) throw new Error('Exclusive ownership is not enabled.');
    if (this.ownershipLost || this.closing)
      throw new Error('Controller ownership was lost or closed.');
    if (this.owner) return true;
    const client = await this.pool.connect();
    const lost = () => {
      if (this.owner !== client || this.closing || this.ownershipLost) return;
      this.ownershipLost = true;
      this.options.onOwnershipLost?.();
    };
    client.on('error', lost);
    client.on('end', lost);
    try {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(20261109, hashtext(current_schema())) AS acquired',
      );
      if (result.rows[0]?.acquired === true) {
        this.owner = client;
        return true;
      }
    } catch (error) {
      client.removeListener('error', lost);
      client.removeListener('end', lost);
      client.release(true);
      throw error;
    }
    client.removeListener('error', lost);
    client.removeListener('end', lost);
    client.release();
    return false;
  }
  private reader(): pg.Pool | pg.PoolClient {
    if (!this.options.exclusive) return this.pool;
    if (!this.owner || this.ownershipLost || this.closing)
      throw new Error('Controller does not own this life.');
    return this.owner;
  }
  async init() {
    await this.reader()
      .query(`CREATE TABLE IF NOT EXISTS elsewhere_snapshots(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS elsewhere_commits(version INTEGER PRIMARY KEY, committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  }
  async load(): Promise<StoredSnapshot<T> | null> {
    const result = await this.reader().query(
      'SELECT version,payload FROM elsewhere_snapshots WHERE id=1',
    );
    return result.rows[0]
      ? { version: result.rows[0].version, value: result.rows[0].payload }
      : null;
  }
  async save(value: T, expectedVersion: number): Promise<number> {
    const client = this.options.exclusive
      ? (this.reader() as pg.PoolClient)
      : await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(20261108)');
      const result = await client.query(
        'SELECT version FROM elsewhere_snapshots WHERE id=1 FOR UPDATE',
      );
      if ((result.rows[0]?.version ?? 0) !== expectedVersion) throw new VersionConflict();
      const next = expectedVersion + 1;
      await client.query(
        'INSERT INTO elsewhere_snapshots(id,version,payload) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload',
        [next, JSON.stringify(value)],
      );
      await client.query('INSERT INTO elsewhere_commits(version) VALUES($1)', [next]);
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      if (!this.options.exclusive) client.release();
    }
  }
  async close() {
    this.closing = true;
    // Destroy the held session: PostgreSQL releases its lock even after a failed query.
    this.owner?.release(true);
    this.owner = undefined;
    await this.pool.end();
  }
}
