import { expect, test } from '@playwright/test';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { createFixtureAccount } from './auth-fixture';

test('real signed assertions reject another account, missing verification, a foreign origin and a foreign RP before granting a session', async ({
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
  const verifyPath = '/api/auth/passkey/verify-authentication';
  const optionsRoute = '**/api/auth/passkey/generate-authenticate-options';
  const verifyRoute = '**/api/auth/passkey/verify-authentication';
  try {
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    async function register(name: string) {
      const email = `${name.toLowerCase()}-${randomUUID()}@example.test`;
      const password = 'isolated-passkey-negative-fixture-password-2026';
      const response = await createFixtureAccount(page.request, origin, { name, email, password });
      expect(response.status()).toBe(200);
      const account = await (await page.request.get('/api/account')).json();
      await page.reload();
      await page.getByRole('button', { name: 'Your account', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const settings = dialog.getByRole('region', { name: 'Account passkeys', exact: true });
      await settings.getByLabel('Passkey name', { exact: true }).fill(`${name} key`);
      await settings.getByRole('button', { name: 'Add a passkey', exact: true }).click();
      await expect(settings).toContainText('Passkey added.');
      await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
      return { id: account.user.id, email, password };
    }
    const first = await register('First');
    const firstCredential = (await cdp.send('WebAuthn.getCredentials', { authenticatorId }))
      .credentials[0];
    const second = await register('Second');
    await cdp.send('WebAuthn.removeCredential', {
      authenticatorId,
      credentialId: firstCredential.credentialId,
    });
    const credentials = (await cdp.send('WebAuthn.getCredentials', { authenticatorId }))
      .credentials;
    expect(credentials.length).toBe(1);
    // This private key is from the disposable virtual authenticator, never an operator/device key.
    const key = createPrivateKey({
      key: Buffer.from(credentials[0].privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const credentialId = Buffer.from(credentials[0].credentialId, 'base64').toString('base64url');
    async function attempt() {
      const verified = page.waitForResponse(
        (response) => new URL(response.url()).pathname === verifyPath,
      );
      const accepted = await page.evaluate(async () => {
        const modulePath = '/src/passkeyAuth.ts';
        const { signInWithPasskey } = await import(modulePath);
        try {
          await signInWithPasskey(new AbortController().signal);
          return true;
        } catch {
          return false;
        }
      });
      return { accepted, response: await verified };
    }
    const fallback = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email: first.email, password: first.password },
    });
    expect(fallback.status()).toBe(200);
    const sessionDigest = async () =>
      createHash('sha256')
        .update(
          JSON.stringify(
            (await context.cookies())
              .filter((cookie) => cookie.name.endsWith('.session_token'))
              .map(({ name, value }) => ({ name, value })),
          ),
        )
        .digest('hex');
    expect(
      (await context.cookies()).filter((cookie) => cookie.name.endsWith('.session_token')),
    ).toHaveLength(1);
    const originalCookie = await sessionDigest();
    // A malicious client can ignore the credential allowlist. The server must still pin identity.
    await page.route(optionsRoute, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const options = await response.json();
      delete options.allowCredentials;
      await route.fulfill({ response, json: options });
    });
    const wrongAccount = await attempt();
    expect(wrongAccount.accepted).toBe(false);
    expect(wrongAccount.response.status()).toBeGreaterThanOrEqual(400);
    expect((await sessionDigest()) === originalCookie).toBe(true);
    expect(await (await page.request.get('/api/account')).json()).toMatchObject({
      user: { id: first.id },
      passkeyVerifiedRecently: false,
    });
    await page.unroute(optionsRoute);
    expect(
      (await page.request.post('/api/auth/sign-out', { headers: { origin }, data: {} })).status(),
    ).toBe(200);

    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await page.route(optionsRoute, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const options = await response.json();
      options.userVerification = 'discouraged';
      await route.fulfill({ response, json: options });
    });
    const unverified = await attempt();
    expect(unverified.accepted).toBe(false);
    expect(unverified.response.status()).toBeGreaterThanOrEqual(400);
    expect((await (await page.request.get('/api/account')).json()).user).toBeNull();
    await page.unroute(optionsRoute);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });

    for (const scenario of ['origin', 'rpId'] as const) {
      await page.route(verifyRoute, async (route) => {
        const body = route.request().postDataJSON();
        expect(body.response.id).toBe(credentialId);
        const assertion = body.response.response;
        if (scenario === 'origin') {
          const data = JSON.parse(Buffer.from(assertion.clientDataJSON, 'base64url').toString());
          data.origin = 'https://attacker.invalid';
          assertion.clientDataJSON = Buffer.from(JSON.stringify(data)).toString('base64url');
        } else {
          const data = Buffer.from(assertion.authenticatorData, 'base64url');
          createHash('sha256').update('attacker.invalid').digest().copy(data, 0);
          assertion.authenticatorData = data.toString('base64url');
        }
        // Re-sign with the genuine fixture key so rejection cannot rely on a bogus signature.
        const signedData = Buffer.concat([
          Buffer.from(assertion.authenticatorData, 'base64url'),
          createHash('sha256').update(Buffer.from(assertion.clientDataJSON, 'base64url')).digest(),
        ]);
        const algorithm = ['ed25519', 'ed448'].includes(key.asymmetricKeyType ?? '')
          ? null
          : 'sha256';
        assertion.signature = sign(algorithm, signedData, key).toString('base64url');
        await route.fulfill({
          response: await route.fetch({ postData: JSON.stringify(body), maxRedirects: 0 }),
        });
      });
      const rejected = await attempt();
      expect(rejected.accepted).toBe(false);
      expect(rejected.response.status()).toBeGreaterThanOrEqual(400);
      expect((await (await page.request.get('/api/account')).json()).user).toBeNull();
      await page.unroute(verifyRoute);
    }
    const legitimate = await attempt();
    expect(legitimate.accepted).toBe(true);
    expect(await legitimate.response.json()).toEqual({ ok: true });
    expect(await (await page.request.get('/api/account')).json()).toMatchObject({
      user: { id: second.id, isWorldAdmin: false },
      passkeyVerifiedRecently: true,
      managedCharacterIds: [],
    });
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
  }
});
