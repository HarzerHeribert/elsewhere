import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ElsewhereController, type ControllerState } from '../app/controller';
import { SqliteSnapshotStore, type SnapshotStore } from '../packages/persistence/src/index';
import type { DecisionProvider } from '../characters/runtime/src/index';

const epoch = Date.UTC(2026, 10, 8, 12);
const step = 2_000;
const hour = 3_600_000;
const resting: DecisionProvider = {
  id: 'offline-test-fixture',
  localOnly: true,
  managesAllowance: true,
  propose: async () => ({ type: 'rest' }),
};
const active = new Set<ElsewhereController>();
const directories: string[] = [];
afterEach(async () => {
  for (const controller of active) await controller.close();
  active.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
async function world(store: SnapshotStore<ControllerState>, clock: { wall: number }, real = true) {
  const controller = await new ElsewhereController(store, {
    now: () => clock.wall,
    simulationStepMs: step,
    simulationRate: 1,
    realTimeClock: real,
    modelProvider: resting,
  }).init();
  active.add(controller);
  return controller;
}
const runtime = (controller: ElsewhereController) => controller.getSnapshot().runtime;

it('keeps pace with real time while running, making up ticks missed during a stall', async () => {
  const clock = { wall: epoch };
  const controller = await world(new SqliteSnapshotStore<ControllerState>(':memory:'), clock);
  for (let tick = 0; tick < 3; tick++) {
    clock.wall += step;
    await controller.tick();
  }
  expect(runtime(controller).simulatedAt).toBe(epoch + 3 * step);
  expect(runtime(controller).clock).toEqual([{ at: epoch + step, wall: epoch + step }]);
  clock.wall += 10_000; // A model request held the next tick back.
  await controller.tick();
  expect(runtime(controller).simulatedAt).toBe(epoch + 3 * step + 10_000);
  expect(runtime(controller).clock).toHaveLength(1);
});

it('stands still across a pause and records where real time resumed', async () => {
  const clock = { wall: epoch };
  const store = new SqliteSnapshotStore<ControllerState>(':memory:');
  const controller = await world(store, clock);
  clock.wall += step;
  await controller.tick();
  await controller.pause();
  const before = (await store.load())!.value.hubert.stats;
  clock.wall += 26 * hour;
  await controller.tick();
  expect(runtime(controller).simulatedAt).toBe(epoch + step);
  await controller.resume();
  await controller.tick();
  const after = runtime(controller);
  expect(after.simulatedAt).toBe(epoch + 2 * step);
  expect(after.clock).toEqual([
    { at: epoch + step, wall: epoch + step },
    { at: epoch + 2 * step, wall: epoch + step + 26 * hour },
  ]);
  // One step of ordinary life passed, not twenty-six hours of it.
  const stats = (await store.load())!.value.hubert.stats;
  expect(Math.abs(stats.energy - before.energy)).toBeLessThan(0.1);
  expect(Math.abs(stats.boredom - before.boredom)).toBeLessThan(0.1);
});

it('treats a short pause and a restart as standing still too', async () => {
  const clock = { wall: epoch };
  const directory = mkdtempSync(join(tmpdir(), 'elsewhere-clock-'));
  directories.push(directory);
  const file = join(directory, 'world.sqlite');
  const first = await world(new SqliteSnapshotStore<ControllerState>(file), clock);
  clock.wall += step;
  await first.tick();
  await first.pause();
  clock.wall += 30_000;
  await first.resume();
  await first.tick();
  expect(runtime(first).simulatedAt).toBe(epoch + 2 * step);
  expect(runtime(first).clock).toHaveLength(2);
  active.delete(first);
  await first.close();
  clock.wall += 20_000;
  const second = await world(new SqliteSnapshotStore<ControllerState>(file), clock);
  await second.tick();
  expect(runtime(second).simulatedAt).toBe(epoch + 3 * step);
  expect(runtime(second).clock?.at(-1)).toEqual({
    at: epoch + 3 * step,
    wall: epoch + step + 50_000,
  });
});

it('keeps a bounded record and reports no clock when it does not follow real time', async () => {
  const clock = { wall: epoch };
  const controller = await world(new SqliteSnapshotStore<ControllerState>(':memory:'), clock);
  for (let pause = 0; pause < 205; pause++) {
    await controller.pause();
    clock.wall += hour;
    await controller.resume();
    await controller.tick();
  }
  expect(runtime(controller).clock).toHaveLength(200);
  expect(runtime(controller).simulatedAt).toBe(epoch + 205 * step);
  const plain = await world(new SqliteSnapshotStore<ControllerState>(':memory:'), clock, false);
  clock.wall += hour;
  await plain.tick();
  expect(runtime(plain).clock).toBeUndefined();
});
