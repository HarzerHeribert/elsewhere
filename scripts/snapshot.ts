import 'dotenv/config';
import {
  constants,
  existsSync,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { exportWorldSnapshot, importWorldSnapshot } from '../app/snapshot-transfer';
import type { ControllerState } from '../app/controller';
import {
  PostgresSnapshotStore,
  SqliteSnapshotStore,
  type SnapshotStore,
} from '../packages/persistence/src/index';

let store: SnapshotStore<ControllerState> | undefined;
try {
  const args = parseArgs({
    options: { file: { type: 'string' }, target: { type: 'string' } },
    allowPositionals: true,
  });
  const operation = args.positionals[0];
  if (
    args.positionals.length !== 1 ||
    !['export', 'import'].includes(operation) ||
    !args.values.file
  )
    throw new Error(
      'Use pnpm snapshot export --file <private-path>, or import --target postgres|sqlite --file <backup>.',
    );
  const file = resolve(args.values.file);
  let input: unknown;
  if (operation === 'import') {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd);
      if (
        !info.isFile() ||
        info.size > 16 * 1024 * 1024 ||
        (info.mode & 0o077) !== 0 ||
        info.nlink !== 1 ||
        (process.getuid && info.uid !== process.getuid())
      )
        throw new Error('Backup must be a private, owned, unlinked regular file below 16 MB.');
      input = JSON.parse(readFileSync(fd, 'utf8'));
    } finally {
      closeSync(fd);
    }
    if (!['postgres', 'sqlite'].includes(args.values.target ?? ''))
      throw new Error('Import requires an explicit --target postgres or --target sqlite.');
    if ((args.values.target === 'postgres') !== Boolean(process.env.DATABASE_URL))
      throw new Error('Target does not match DATABASE_URL configuration.');
  }
  if (process.env.DATABASE_URL) {
    const postgres = new PostgresSnapshotStore<ControllerState>(process.env.DATABASE_URL, {
      exclusive: operation === 'import',
    });
    store = postgres;
    if (operation === 'import') {
      if (!(await postgres.tryAcquireOwnership()))
        throw new Error('Stop the destination runtime before importing its life.');
      await postgres.init();
    }
  } else {
    const database = resolve(process.env.DATA_DIR ?? '.data', 'elsewhere.sqlite');
    if (operation === 'export' && !existsSync(database))
      throw new Error('Source world database does not exist.');
    store = new SqliteSnapshotStore<ControllerState>(database);
  }
  if (operation === 'export') {
    const snapshot = await store.load();
    if (!snapshot) throw new Error('Source has no saved life.');
    const fd = openSync(
      file,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, JSON.stringify(exportWorldSnapshot(snapshot)) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    console.log(
      'Private world backup written. Accounts are separate; no snapshot contents were displayed.',
    );
  } else {
    await importWorldSnapshot(store, input);
    console.log(
      'World imported into an empty destination. No tick, reset or external request was made.',
    );
  }
} catch (error) {
  // Do not display database URLs, JSON parse excerpts or private payloads from foreign errors.
  const known =
    error instanceof Error &&
    /^(Use pnpm|Backup must|Import requires|Target does|Stop the|Source |Destination already|Backup format|Backup state)/.test(
      error.message,
    );
  console.error(
    known
      ? error.message
      : 'Snapshot operation failed. Check private paths, permissions and database configuration; no data was displayed.',
  );
  process.exitCode = 1;
} finally {
  await store?.close();
}
