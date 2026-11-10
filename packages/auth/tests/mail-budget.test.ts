import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { AuthMailBudget } from '../src/mail-budget';

const directories: string[] = [],
  connections: Database.Database[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(maxPerDay = 100) {
  const dir = mkdtempSync(join(tmpdir(), 'elsewhere-mail-budget-'));
  directories.push(dir);
  const file = join(dir, 'mail.sqlite');
  let now = Date.UTC(2026, 10, 10, 12);
  const open = () => {
    const db = new Database(file);
    connections.push(db);
    return db;
  };
  const db = open(),
    budget = new AuthMailBudget({ sqlite: db }, 'fixture-mail-secret', { maxPerDay }, () => now);
  return { db, budget, open, advance: (ms: number) => (now += ms), now: () => now };
}
it('shares recipient limits across spelling and purposes, persists cooldown across restart, and stores no addresses or tokens', async () => {
  const f = fixture();
  await f.budget.init();
  expect(await f.budget.reserve('Owner@Example.Invalid')).toBe(true);
  expect(await f.budget.reserve('owner@example.invalid')).toBe(false);
  const second = new AuthMailBudget({ sqlite: f.open() }, 'fixture-mail-secret', {}, f.now);
  await second.init();
  expect(await second.reserve('owner@example.invalid')).toBe(false);
  f.advance(60000);
  expect(await second.reserve('owner@example.invalid')).toBe(true);
  f.advance(60000);
  expect(await second.reserve('owner@example.invalid')).toBe(true);
  f.advance(60000);
  expect(await second.reserve('owner@example.invalid')).toBe(false);
  const rows = f.db.prepare('SELECT * FROM elsewhere_auth_mail_budget').all();
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toMatch(/owner|example|token/i);
});
it('atomically reserves global capacity and never refunds failed delivery reservations', async () => {
  const f = fixture(2);
  await f.budget.init();
  const allowed = await Promise.all(
    Array.from({ length: 20 }, (_, i) => f.budget.reserve(`person${i}@example.invalid`)),
  );
  expect(allowed.filter(Boolean)).toHaveLength(2);
  const reopened = new AuthMailBudget(
    { sqlite: f.open() },
    'fixture-mail-secret',
    { maxPerDay: 2 },
    f.now,
  );
  await reopened.init();
  expect(await reopened.reserve('another@example.invalid')).toBe(false);
  f.advance(24 * 60 * 60000);
  expect(await reopened.reserve('another@example.invalid')).toBe(true);
});
it('bounds recipient storage and does not replenish on clock rollback or malformed persisted data', async () => {
  const f = fixture(10000);
  await f.budget.init();
  const allowed = await Promise.all(
    Array.from({ length: 250 }, (_, i) => f.budget.reserve(`person${i}@example.invalid`)),
  );
  expect(allowed.filter(Boolean)).toHaveLength(200);
  let state = JSON.parse(
    (f.db.prepare('SELECT payload FROM elsewhere_auth_mail_budget').get() as { payload: string })
      .payload,
  );
  expect(state.recipients).toHaveLength(200);
  f.advance(-24 * 60 * 60000);
  expect(await f.budget.reserve('new@example.invalid')).toBe(false);
  f.advance(3 * 24 * 60 * 60000);
  expect(await f.budget.reserve('new@example.invalid')).toBe(true);
  state = JSON.parse(
    (f.db.prepare('SELECT payload FROM elsewhere_auth_mail_budget').get() as { payload: string })
      .payload,
  );
  expect(state.recipients).toHaveLength(1);
  f.db.prepare("UPDATE elsewhere_auth_mail_budget SET payload='{}'").run();
  await expect(f.budget.reserve('new@example.invalid')).rejects.toThrow();
});
