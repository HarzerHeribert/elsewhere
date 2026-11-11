import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ElsewhereController, type ControllerState } from '../app/controller';
import { SqliteSnapshotStore, type SnapshotStore } from '../packages/persistence/src/index';
import { RoutedDecisionProvider } from '../packages/adapters/src/models/routed';
import type { DecisionContext } from '@elsewhere/character-runtime';
import type { ModelBudgetPort } from '../packages/models/src/contracts';
import { modelPolicy, modelProfile, routingConfig } from './model-fixtures';

const now = Date.UTC(2026, 10, 8, 12);
const active: ElsewhereController[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const controller of active.splice(0)) await controller.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function response(content = '{"type":"rest"}') {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    }),
  );
}
async function create(
  fetcher: typeof fetch,
  file = ':memory:',
  options: { maximum?: number; failWrite?: number; backup?: boolean } = {},
) {
  const backing = new SqliteSnapshotStore<ControllerState>(file);
  let writes = 0;
  const store: SnapshotStore<ControllerState> = {
    load: () => backing.load(),
    close: () => backing.close(),
    save: (value, version) => {
      if (++writes === options.failWrite)
        return Promise.reject(new Error('isolated storage failure'));
      return backing.save(value, version);
    },
  };
  const config = routingConfig({
    profiles: [modelProfile(), ...(options.backup ? [modelProfile('backup')] : [])],
    policies: {
      decision: modelPolicy({
        models: options.backup ? ['cf-routine', 'backup'] : ['cf-routine'],
        maxAttempts: options.backup ? 2 : 1,
      }),
    },
  });
  let routed!: RoutedDecisionProvider;
  const controller = await new ElsewhereController(store, {
    now: () => now,
    modelMaximum: options.maximum ?? 10,
    modelProvider: {
      id: 'routed',
      managesAllowance: true,
      propose: (context: DecisionContext) => routed.propose(context),
    },
  }).init();
  active.push(controller);
  routed = new RoutedDecisionProvider(
    config,
    controller.modelBudget(config),
    { MODEL_FIXTURE_KEY: 'fixture-only-not-a-live-key' },
    { fetcher, now: () => now },
  );
  return { controller, backing, routed };
}

it('persists reservation before each routed HTTP attempt and reconciles cache tokens privately', async () => {
  let backing!: SqliteSnapshotStore<ControllerState>;
  const reservations: number[] = [];
  const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const saved = (await backing.load())!.value;
    reservations.push(saved.modelAllowance.calls);
    expect(saved.modelRouting!.receipts.at(-1)!.status).toBe('pending');
    expect(saved.modelRouting!.days['2026-11-08'].microUsd).toBeGreaterThan(0);
    const body = JSON.parse(String(init?.body));
    expect(body.max_tokens).toBe(160);
    expect(body.prompt_cache_key).toMatch(/^ew-[0-9a-f]{64}$/);
    return response(reservations.length === 1 ? '{"type":"shell","command":"no"}' : undefined);
  });
  const h = await create(fetcher as typeof fetch, ':memory:', { backup: true });
  backing = h.backing;
  const snapshot = await h.controller.step();
  expect(reservations).toEqual([1, 2]);
  const saved = (await backing.load())!.value;
  expect(saved.modelRouting!.receipts.map((item) => item.status)).toEqual(['failed', 'complete']);
  expect(saved.modelRouting!.days['2026-11-08']).toMatchObject({
    attempts: 2,
    cachedInputTokens: 160,
    microUsd: 96,
  });
  expect(saved.modelAllowance).toMatchObject({ calls: 2, inputTokens: 200, outputTokens: 20 });
  expect(snapshot.runtime.modelCalls).toBe(2);
  expect(JSON.stringify(snapshot)).not.toContain('fixture-only');
  expect(snapshot).not.toHaveProperty('modelRouting');
});

it('retains routed allowances through reset and restart without resetting real spending', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'elsewhere-routing-'));
  directories.push(directory);
  const file = join(directory, 'fixture.sqlite');
  const fetcher = vi.fn(async () => response());
  const first = await create(fetcher as typeof fetch, file, { maximum: 1 });
  await first.controller.step();
  const ledger = structuredClone((await first.backing.load())!.value.modelRouting);
  await first.controller.reset();
  expect((await first.backing.load())!.value.modelRouting).toEqual(ledger);
  await first.controller.close();
  active.splice(active.indexOf(first.controller), 1);
  const restarted = await create(fetcher as typeof fetch, file, { maximum: 1 });
  await restarted.controller.step();
  expect(fetcher).toHaveBeenCalledOnce();
  expect((await restarted.backing.load())!.value.modelRouting).toEqual(ledger);
});

it.each([2, 3])(
  'stops routed dispatch on durable write failure %i without paid failover',
  async (failWrite) => {
    const fetcher = vi.fn(async () => response());
    const h = await create(fetcher as typeof fetch, ':memory:', { failWrite, backup: true });
    await expect(h.controller.step()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(failWrite === 2 ? 0 : 1);
    expect(h.controller.getSnapshot().runtime.modelStatus).toContain('halted');
    if (failWrite === 3)
      expect((await h.backing.load())!.value.modelRouting!.receipts[0].status).toBe('pending');
  },
);

it('does not allow the budget port to dispatch outside the owned controller lane', async () => {
  const h = await create((async () => response()) as typeof fetch);
  const budget: ModelBudgetPort = h.controller.modelBudget(routingConfig());
  await expect(
    budget.reserve({ profileId: 'cf-routine', workload: 'decision', maximumMicroUsd: 1 }),
  ).rejects.toThrow('No active');
  expect((await h.backing.load())!.value.modelAllowance.calls).toBe(0);
});
