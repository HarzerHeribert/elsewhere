import { expect, type APIRequestContext, type APIResponse, type TestInfo } from '@playwright/test';
import type { AccountResponse, AccountSummary } from '@elsewhere/character-interfaces';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** Real ceremonies need a fresh auth window, rather than silently retrying WebAuthn. */
export async function waitForFixtureAuthWindow(info: TestInfo): Promise<void> {
  const directory: unknown = info.config.metadata.testDataDirectory;
  if (
    typeof directory !== 'string' ||
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !/^elsewhere-e2e-run-[a-zA-Z0-9-]+$/.test(basename(directory))
  )
    throw new Error('Expected the isolated browser fixture authentication database.');
  const db = new Database(join(directory, 'auth.sqlite'), { readonly: true, fileMustExist: true });
  let lastRequest: number;
  try {
    const latest = db
      .prepare('SELECT MAX(lastRequest) AS at FROM elsewhere_auth_rate_limit')
      .get() as {
      at: number | null;
    };
    lastRequest = latest.at ?? 0;
  } finally {
    db.close();
  }
  if (!Number.isSafeInteger(lastRequest) || lastRequest < 0 || lastRequest > Date.now() + 1000)
    throw new Error('Fixture authentication window timestamp is invalid.');
  const remaining = lastRequest + 60_000 - Date.now();
  if (remaining > 0)
    await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, remaining + 50)));
}

/** Account reads share the real public-read budget; wait only for explicit admission rejection. */
export async function fixtureAccount(
  request: APIRequestContext,
): Promise<AccountResponse & { user: AccountSummary }> {
  const deadline = Date.now() + 25000;
  for (;;) {
    const response = await request.get('/api/account');
    if (response.status() !== 429 || Date.now() >= deadline) {
      expect(response.status(), 'Fixture account read must succeed before parsing').toBe(200);
      const account = (await response.json()) as AccountResponse;
      expect(account.user?.id, 'Fixture must retain its authenticated account').toBeTruthy();
      if (!account.user) throw new Error('Fixture account is not authenticated.');
      return { ...account, user: account.user };
    }
    const after = Number(response.headers()['retry-after']);
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(5000, Math.max(1000, Number.isFinite(after) ? after * 1000 : 2000)),
      ),
    );
  }
}

/** Security browser cases share one server; honor its real admission budget between fixtures. */
export async function createFixtureAccount(
  request: APIRequestContext,
  origin: string,
  details: { name: string; email: string; password: string },
): Promise<APIResponse> {
  const deadline = Date.now() + 70000;
  for (;;) {
    const response = await request.post('/api/auth/sign-up/email', {
      headers: { origin },
      data: details,
    });
    if (response.status() !== 429 || Date.now() >= deadline) return response;
    const after = Number(response.headers()['retry-after']);
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(5000, Math.max(1000, Number.isFinite(after) ? after * 1000 : 2000)),
      ),
    );
  }
}
