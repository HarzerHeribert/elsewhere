import { expect, it } from 'vitest';
import { ElsewhereController, type ControllerState } from './controller';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';
import { decodeWorldSnapshot, exportWorldSnapshot, importWorldSnapshot } from './snapshot-transfer';

it('transfers a lived life, private notes and actual allowance without replaying activity', async () => {
  const source = new SqliteSnapshotStore<ControllerState>(':memory:');
  const controller = await new ElsewhereController(source).init();
  const destination = new SqliteSnapshotStore<ControllerState>(':memory:');
  let resumed: ElsewhereController | undefined;
  try {
    await controller.submitMessage('fixture private note');
    await controller.step();
    await controller.pause();
    const original = (await source.load())!;
    const backup = JSON.parse(JSON.stringify(exportWorldSnapshot(original)));
    const decoded = await decodeWorldSnapshot(backup);
    expect(decoded).toEqual(original.value);
    await importWorldSnapshot(destination, backup);
    resumed = await new ElsewhereController(destination).init();
    expect(resumed.getSnapshot()).toEqual(controller.getSnapshot());
    expect((await destination.load())!.value).toEqual(original.value);
    expect((await destination.load())!.value.modelAllowance).toEqual(original.value.modelAllowance);
    await expect(importWorldSnapshot(destination, backup)).rejects.toThrow('already has a life');
    expect((await destination.load())!.value).toEqual(original.value);
  } finally {
    await controller.close();
    if (resumed) await resumed.close();
    else await destination.close();
  }
});

it('rejects corrupted and incompatible backups without changing the destination', async () => {
  const source = new SqliteSnapshotStore<ControllerState>(':memory:');
  const controller = await new ElsewhereController(source).init();
  const destination = new SqliteSnapshotStore<ControllerState>(':memory:');
  try {
    const saved = (await source.load())!;
    const backup = exportWorldSnapshot(saved);
    await expect(
      importWorldSnapshot(destination, { ...backup, sha256: '0'.repeat(64) }),
    ).rejects.toThrow('integrity');
    const malformed = structuredClone(saved);
    Reflect.set(malformed.value.hubert, 'id', 'another-creature');
    await expect(importWorldSnapshot(destination, exportWorldSnapshot(malformed))).rejects.toThrow(
      'incompatible',
    );
    await expect(
      importWorldSnapshot(destination, { format: 'elsewhere-world-snapshot/v1' }),
    ).rejects.toThrow('integrity');
    expect(await destination.load()).toBeNull();
  } finally {
    await controller.close();
    await destination.close();
  }
});
