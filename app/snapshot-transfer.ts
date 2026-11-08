import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ElsewhereController, type ControllerState } from './controller';
import {
  SqliteSnapshotStore,
  type SnapshotStore,
  type StoredSnapshot,
} from '../packages/persistence/src/index';

const envelope = z
  .object({
    format: z.literal('elsewhere-world-snapshot/v1'),
    createdAt: z.string().datetime(),
    sourceVersion: z.number().int().positive().safe(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Contains private memories/messages. Integrity hash detects corruption, not malicious authors. */
export function exportWorldSnapshot(snapshot: StoredSnapshot<ControllerState>) {
  return {
    format: 'elsewhere-world-snapshot/v1' as const,
    createdAt: new Date().toISOString(),
    sourceVersion: snapshot.version,
    sha256: digest(snapshot.value),
    payload: snapshot.value,
  };
}

/** Validate/migrate through the real controller in memory, without a tick or provider call. */
export async function decodeWorldSnapshot(input: unknown): Promise<ControllerState> {
  const parsed = envelope.safeParse(input);
  if (!parsed.success || digest(parsed.data.payload) !== parsed.data.sha256)
    throw new Error('Backup format or integrity check failed. No state was imported.');
  const validation = new SqliteSnapshotStore<ControllerState>(':memory:');
  let controller: ElsewhereController | undefined;
  try {
    await validation.save(parsed.data.payload as unknown as ControllerState, 0);
    controller = new ElsewhereController(validation);
    await controller.init();
    return (await validation.load())!.value;
  } catch {
    throw new Error('Backup state is incompatible. No destination state was changed.');
  } finally {
    if (controller) await controller.close();
    else await validation.close();
  }
}

/** Only a new/empty destination can receive a transfer. Existing lives are never overwritten. */
export async function importWorldSnapshot(store: SnapshotStore<ControllerState>, input: unknown) {
  const state = await decodeWorldSnapshot(input);
  if (await store.load()) throw new Error('Destination already has a life. Import refused.');
  await store.save(state, 0);
}
