import { expect, test } from '@playwright/test';

test('email-link sign-in uses account capability flags and never claims sign-in before redemption', async ({
  page,
}) => {
  await page.route('**/api/account', (route) =>
    route.fulfill({
      json: {
        user: null,
        enabled: true,
        passwordAuthEnabled: true,
        emailLinkAuthEnabled: true,
        requiresEmailVerification: true,
        managedCharacterIds: [],
      },
    }),
  );
  let sends = 0;
  await page.route('**/api/auth/sign-in/magic-link', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({
      email: 'owner@example.test',
      callbackURL: new URL(page.url()).origin,
    });
    sends++;
    await route.fulfill({ json: { status: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await dialog.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('one-use sign-in link');
  await expect(dialog).not.toContainText('You are signed in');
  expect(sends).toBe(1);
  await dialog.getByRole('button', { name: 'Use another email', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use a password instead', exact: true }).click();
  await expect(dialog.getByLabel('Password', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use an email link instead', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Email me a sign-in link', exact: true }),
  ).toBeVisible();
});

test('a model correction notice distinguishes paced reconsideration from owner intervention', async ({
  page,
}) => {
  const issue = {
    id: 'fixture-issue',
    characterId: 'hubert',
    kind: 'invalid',
    workload: 'decision',
    since: 1000,
    lastAt: 1000,
    code: 'invalid_action',
    fields: ['durationMs'],
    retrying: true,
    message: 'Hubert will reconsider on his next normal turn.',
  };
  await page.route('**/api/account', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'fixture-owner',
          name: 'Owner',
          email: 'owner@example.test',
          emailVerified: true,
          role: 'user',
          isWorldAdmin: false,
        },
        enabled: true,
        passwordAuthEnabled: true,
        requiresEmailVerification: true,
        managedCharacterIds: ['hubert'],
        characterIssues: [issue],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  const notices = page.getByRole('region', { name: 'Character provider notices' });
  await expect(notices).toContainText('Hubert · Reconsidering');
  await expect(notices).toContainText('allowed action format');
  await expect(notices.getByRole('button', { name: 'Retry Hubert' })).toHaveCount(0);
  await expect(page.getByLabel('Character needs attention', { exact: true })).toHaveCount(0);
  issue.retrying = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notices).toContainText('Hubert · Needs attention');
  await expect(notices.getByRole('button', { name: 'Retry Hubert' })).toBeVisible();
});
