import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { ElsewhereController, type ControllerState } from './controller';
import { exportWorldSnapshot, importWorldSnapshot } from './snapshot-transfer';
import { SqliteSnapshotStore, PostgresSnapshotStore } from '../packages/persistence/src/index';

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'moves an existing SQLite life into an empty PostgreSQL deployment exactly',
  async () => {
    const schema = 'elsewhere_transfer_' + randomBytes(8).toString('hex');
    const base = process.env.TEST_DATABASE_URL!;
    const admin = new pg.Pool({ connectionString: base, max: 1 });
    const url = new URL(base);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const source = new SqliteSnapshotStore<ControllerState>(':memory:');
    const controller = await new ElsewhereController(source).init();
    const target = new PostgresSnapshotStore<ControllerState>(url.toString(), { exclusive: true });
    let resumed: ElsewhereController | undefined;
    try {
      await controller.submitMessage('fixture private thought retained by migration');
      await controller.step();
      await controller.pause();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      expect(await target.tryAcquireOwnership()).toBe(true);
      await target.init();
      const saved = (await source.load())!;
      await importWorldSnapshot(target, JSON.parse(JSON.stringify(exportWorldSnapshot(saved))));
      expect((await target.load())!.value).toEqual(saved.value);
      resumed = await new ElsewhereController(target).init();
      expect(resumed.getSnapshot()).toEqual(controller.getSnapshot());
    } finally {
      await controller.close();
      if (resumed) await resumed.close();
      else await target.close();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
