import { expect, test } from '@playwright/test';
import type { AccountResponse, ProviderIssue } from '@elsewhere/character-interfaces';

test('owner sees current format feedback, collapsed history, and an acknowledged retry that unlocks only after a new result', async ({
  page,
}, info) => {
  const epoch = Date.UTC(2026, 10, 10, 0);
  const current: ProviderIssue = {
    id: 'current-format-failure',
    characterId: 'hubert',
    kind: 'invalid',
    code: 'invalid_json',
    workload: 'decision',
    since: epoch,
    lastAt: epoch + 10000,
    message: 'Three consecutive model replies could not be used.',
  };
  const account: AccountResponse = {
    user: {
      id: 'private-notice-owner',
      name: 'Character Owner',
      email: 'owner@example.test',
      emailVerified: true,
      role: 'user',
      isWorldAdmin: false,
    },
    enabled: true,
    passwordAuthEnabled: true,
    requiresEmailVerification: true,
    managedCharacterIds: ['hubert'],
    characterIssues: [
      { ...current, id: 'older-format', lastAt: epoch - 2000, resolvedAt: epoch - 1000 },
      { ...current, id: 'older-action', code: 'unavailable_action', resolvedAt: epoch - 500 },
      current,
    ],
  };
  let retries = 0;
  await page.route('**/api/account', (route) => route.fulfill({ json: account }));
  await page.route('**/api/characters/hubert/provider/retry', async (route) => {
    expect(route.request().method()).toBe('POST');
    retries++;
    await route.fulfill({ json: { accepted: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  const notices = page.getByRole('region', { name: 'Character provider notices' });
  await expect(notices).toContainText('Hubert · Needs attention');
  await expect(notices).toContainText(
    'The model answered, but its reply could not be read as a JSON action.',
  );
  await expect(notices).toContainText('Last attempt');
  const history = notices.locator('.character-provider-notices__history');
  await expect(history.locator('summary').first()).toHaveText('Recovered issues · 2');
  await expect(history.getByText('Hubert · Recovered', { exact: true }).first()).not.toBeVisible();
  await history.locator('summary').first().click();
  await expect(history.getByText('Hubert · Recovered', { exact: true }).first()).toBeVisible();
  await history.locator('summary').first().click();
  await notices.getByRole('button', { name: 'Retry Hubert', exact: true }).click();
  await expect(notices.getByRole('status')).toContainText('Waiting for the next turn.');
  await expect(notices).toContainText('Hubert · Retry scheduled');
  await expect(notices.getByRole('button', { name: 'Retry Hubert', exact: true })).toHaveCount(0);
  expect(retries).toBe(1);

  current.lastAt += 30000;
  current.code = 'invalid_action';
  current.fields = ['type'];
  current.message = 'The new reply still could not be used.';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notices).toContainText('Hubert · Needs attention');
  await expect(notices).toContainText('allowed action format');
  await expect(notices.getByRole('status')).toHaveCount(0);
  await expect(notices.getByRole('button', { name: 'Retry Hubert', exact: true })).toBeVisible();
  await notices.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('current-provider-feedback.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await notices.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('current-provider-feedback-mobile.png'),
    animations: 'disabled',
  });
});
