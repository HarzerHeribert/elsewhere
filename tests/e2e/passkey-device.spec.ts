import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createFixtureAccount, waitForFixtureAuthWindow } from './auth-fixture';

test('enrollment defaults to this device, offers an explicit security key, and sign-in still accepts that key', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120000);
  await waitForFixtureAuthWindow(info);
  const cdp = await context.newCDPSession(page),
    authenticators = new Set<string>();
  await cdp.send('WebAuthn.enable');
  const addAuthenticator = async (transport: 'internal' | 'usb') => {
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport,
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    authenticators.add(authenticatorId);
    return authenticatorId;
  };
  const native = await addAuthenticator('internal');
  await page.addInitScript(() => {
    const captured = { create: [] as unknown[], get: [] as unknown[] };
    Object.defineProperty(window, '__webauthnOptions', { value: captured });
    const create = navigator.credentials.create.bind(navigator.credentials),
      get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.create = async (options) => {
      captured.create.push({
        authenticatorAttachment:
          options?.publicKey?.authenticatorSelection?.authenticatorAttachment,
        userVerification: options?.publicKey?.authenticatorSelection?.userVerification,
        residentKey: options?.publicKey?.authenticatorSelection?.residentKey,
      });
      return create(options);
    };
    navigator.credentials.get = async (options) => {
      captured.get.push({
        userVerification: options?.publicKey?.userVerification,
        restrictedAttachment: Object.prototype.hasOwnProperty.call(
          options?.publicKey ?? {},
          'authenticatorAttachment',
        ),
      });
      return get(options);
    };
  });
  try {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    const signup = await createFixtureAccount(page.request, origin, {
      name: 'Device Passkey Visitor',
      email: `device-passkey-${randomUUID()}@example.test`,
      password: 'isolated-native-passkey-fixture-only-2026',
    });
    expect(signup.status()).toBe(200);
    const original = await page.request.get('/api/account').then((r) => r.json());
    await page.reload();
    await page.getByRole('button', { name: 'Your account', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      settings = dialog.getByRole('region', { name: 'Account passkeys', exact: true });
    await expect(settings).toContainText('No passkeys added yet.');
    await expect(settings.getByLabel('Save passkey using', { exact: true })).toHaveValue(
      'platform',
    );
    await settings.getByLabel('Passkey name', { exact: true }).fill('Device key');
    await settings.getByRole('button', { name: 'Add a passkey', exact: true }).click();
    await expect(settings.getByText('Device key', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, '__webauthnOptions').create[0])).toEqual({
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'required',
    });

    // Keep the server's device credential, but only a USB authenticator is now available to this browser.
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: native });
    authenticators.delete(native);
    await addAuthenticator('usb');
    await settings.getByLabel('Save passkey using', { exact: true }).selectOption('cross-platform');
    await settings.getByLabel('Passkey name', { exact: true }).fill('Security key');
    await settings.getByRole('button', { name: 'Add a passkey', exact: true }).click();
    await expect(settings.getByText('Security key', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, '__webauthnOptions').create[1])).toEqual({
      authenticatorAttachment: 'cross-platform',
      userVerification: 'required',
      residentKey: 'required',
    });

    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toContainText('Use a passkey you have already added to Elsewhere.');
    await expect(dialog).toContainText('No Elsewhere passkey yet?');
    await expect(dialog).toContainText('then add one under Your account → Passkeys.');
    await dialog.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await expect(dialog).toContainText('You are signed in as Device Passkey Visitor.');
    const signed = await page.request.get('/api/account').then((r) => r.json());
    expect(signed.user.id).toBe(original.user.id);
    expect(signed.passkeyVerifiedRecently).toBe(true);
    expect(await page.evaluate(() => Reflect.get(window, '__webauthnOptions').get.at(-1))).toEqual({
      userVerification: 'required',
      restrictedAttachment: false,
    });
  } finally {
    for (const authenticatorId of authenticators)
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
  }
});
