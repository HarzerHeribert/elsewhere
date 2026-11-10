import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createFixtureAccount } from './auth-fixture';

test('a real passkey registers, signs in to the same account only after a cookie is set, and can be revoked with confirmation', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  try {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    const created = await createFixtureAccount(page.request, origin, {
      name: 'Passkey Visitor',
      email: `passkey-${randomUUID()}@example.test`,
      password: 'isolated-passkey-fixture-password-only-2026',
    });
    expect(created.status()).toBe(200);
    const before = await page.request.get('/api/account');
    const original = await before.json();
    expect(original.user?.id).toBeTruthy();
    expect(original.user.isWorldAdmin).toBe(false);
    expect(original.managedCharacterIds).toEqual([]);
    await page.reload();
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    let dialog = page.getByRole('dialog');
    const settings = dialog.getByRole('region', { name: 'Account passkeys', exact: true });
    await expect(settings).toContainText('No passkeys added yet.');
    await settings.getByLabel('Passkey name', { exact: true }).fill('My test MacBook');
    const registration = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/passkey/verify-registration',
    );
    await settings.getByRole('button', { name: 'Add a passkey', exact: true }).click();
    expect(await (await registration).json()).toEqual({ ok: true });
    await expect(settings).toContainText('Passkey added.');
    await expect(settings.getByText('My test MacBook', { exact: true })).toBeVisible();
    await expect(dialog.locator('.account-details code')).toHaveText(original.user.id);
    await expect(
      settings.getByRole('button', { name: 'Require passkey for owner controls' }),
    ).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    dialog = page.getByRole('dialog');
    // A nominal successful response without a session cookie must never claim sign-in.
    await page.route('**/api/auth/passkey/verify-authentication', (route) =>
      route.fulfill({ json: { ok: true } }),
    );
    await dialog.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Your session could not be confirmed.');
    await expect(dialog).not.toContainText('You are signed in');
    await page.unroute('**/api/auth/passkey/verify-authentication');
    const authentication = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/passkey/verify-authentication',
    );
    await dialog.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    expect(await (await authentication).json()).toEqual({ ok: true });
    await expect(dialog).toContainText('You are signed in as Passkey Visitor.');
    await expect(dialog.locator('.account-details code')).toHaveText(original.user.id);
    const after = await page.request.get('/api/account');
    expect(await after.json()).toMatchObject({
      user: { id: original.user.id, isWorldAdmin: false },
      managedCharacterIds: [],
      passkeyVerifiedRecently: true,
    });

    let deletions = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/auth/passkey/delete-passkey') deletions++;
    });
    const signedInSettings = dialog.getByRole('region', { name: 'Account passkeys', exact: true });
    await signedInSettings
      .getByRole('button', { name: 'Remove My test MacBook', exact: true })
      .click();
    await expect(
      signedInSettings.getByRole('button', { name: 'Confirm removal', exact: true }),
    ).toBeVisible();
    expect(deletions).toBe(0);
    await signedInSettings.getByRole('button', { name: 'Keep passkey', exact: true }).click();
    expect(deletions).toBe(0);
    await signedInSettings
      .getByRole('button', { name: 'Remove My test MacBook', exact: true })
      .click();
    await signedInSettings.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await expect(signedInSettings).toContainText('Passkey removed.');
    await expect(signedInSettings).toContainText('No passkeys added yet.');
    expect(deletions).toBe(1);
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('The passkey could not sign you in.');
    await expect(dialog).not.toContainText('You are signed in');
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
  }
});

test('an owner opts into passkey controls explicitly and an ordinary fallback session must verify before changing the world', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  try {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    const email = `passkey-owner-${randomUUID()}@example.test`;
    const password = 'isolated-passkey-owner-fixture-password-only-2026';
    const created = await createFixtureAccount(page.request, origin, {
      name: 'Passkey Owner',
      email,
      password,
    });
    expect(created.status()).toBe(200);
    const original = await (await page.request.get('/api/account')).json();
    // Provision a world administrator only inside this disposable fixture's database.
    // No application request can grant this role, and operator/private data is excluded.
    const directory: unknown = info.config.metadata.testDataDirectory;
    if (
      typeof directory !== 'string' ||
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !/^elsewhere-e2e-run-[a-zA-Z0-9-]+$/.test(basename(directory))
    )
      throw new Error('Expected the isolated browser fixture database.');
    const db = new Database(join(directory, 'auth.sqlite'));
    try {
      expect(
        db.prepare("UPDATE elsewhere_auth_user SET role='admin' WHERE id=?").run(original.user.id)
          .changes,
      ).toBe(1);
    } finally {
      db.close();
    }
    await page.reload();
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    let dialog = page.getByRole('dialog');
    let settings = dialog.getByRole('region', { name: 'Account passkeys', exact: true });
    await settings.getByLabel('Passkey name', { exact: true }).fill('Owner test key');
    await settings.getByRole('button', { name: 'Add a passkey', exact: true }).click();
    await expect(settings.getByText('Owner test key', { exact: true })).toBeVisible();
    await expect(
      settings.getByRole('button', { name: 'Require passkey for owner controls', exact: true }),
    ).toBeDisabled();
    expect(
      (await (await page.request.get('/api/account')).json()).ownerControlsRequirePasskey,
    ).toBe(false);
    await settings.getByRole('button', { name: 'Verify passkey', exact: true }).click();
    await expect(settings).toContainText('Passkey verified.');
    await settings
      .getByRole('button', { name: 'Require passkey for owner controls', exact: true })
      .click();
    await expect(settings).toContainText('Owner controls now require a verified passkey.');
    expect(await (await page.request.get('/api/account')).json()).toMatchObject({
      user: { id: original.user.id, isWorldAdmin: true },
      ownerControlsRequirePasskey: true,
      ownerControlsUnlocked: true,
    });
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    const fallback = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    });
    expect(fallback.status()).toBe(200);
    expect(await (await page.request.get('/api/account')).json()).toMatchObject({
      user: { id: original.user.id, isWorldAdmin: true },
      ownerControlsRequirePasskey: true,
      ownerControlsUnlocked: false,
      passkeyVerifiedRecently: false,
    });
    const denied = await page.request.post('/api/admin/pause', { headers: { origin }, data: {} });
    expect(denied.status()).toBe(403);
    await page.reload();
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    dialog = page.getByRole('dialog');
    settings = dialog.getByRole('region', { name: 'Account passkeys', exact: true });
    await expect(dialog).toContainText('Owner controls are locked');
    await expect(
      settings.getByRole('button', { name: 'Add a passkey', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'World settings', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('button', { name: 'Unlock owner controls', exact: true }).click();
    await expect(settings).toContainText('Passkey verified.');
    await expect(dialog.getByRole('button', { name: 'World settings', exact: true })).toBeEnabled();
    const allowed = await page.request.post('/api/admin/resume', { headers: { origin }, data: {} });
    expect(allowed.status()).toBe(200);
    await expect(
      settings.getByRole('button', { name: 'Remove Owner test key', exact: true }),
    ).toBeDisabled();
    await settings
      .getByRole('button', { name: 'Turn off passkey requirement', exact: true })
      .click();
    await expect(settings).toContainText('Passkey requirement for owner controls removed.');
    await expect(
      settings.getByRole('button', { name: 'Remove Owner test key', exact: true }),
    ).toBeEnabled();
    await settings.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('owner-passkey-settings.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await settings.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('owner-passkey-settings-mobile.png'),
      animations: 'disabled',
    });
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
  }
});
