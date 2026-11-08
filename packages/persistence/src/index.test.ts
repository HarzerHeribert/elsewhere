import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSnapshotStore, VersionConflict } from './index';

describe('durable local state', () => {
  it('recovers the last committed state after reopening and rejects stale writers', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'elsewhere-store-'));
    const file = join(directory, 'world.sqlite');
    const first = new SqliteSnapshotStore<{ memory: string }>(file);
    expect(await first.load()).toBeNull();
    expect(await first.save({ memory: 'the workshop' }, 0)).toBe(1);
    await first.close();
    const second = new SqliteSnapshotStore<{ memory: string }>(file);
    expect(await second.load()).toEqual({ version: 1, value: { memory: 'the workshop' } });
    await expect(second.save({ memory: 'stale' }, 0)).rejects.toBeInstanceOf(VersionConflict);
    expect((await second.load())?.value.memory).toBe('the workshop');
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
