import { expect, test } from '@playwright/test';

const guest = {
  user: null,
  enabled: true,
  passwordAuthEnabled: true,
  emailLinkAuthEnabled: true,
  passkeyAuthEnabled: true,
  requiresEmailVerification: true,
  managedCharacterIds: [],
};
const destinations = {
  github: 'https://github.com/login/oauth/authorize?client_id=fixture&state=fixture',
  google: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=fixture',
};

test('unconfigured identity providers have no sign-in or linking buttons', async ({ page }) => {
  await page.route('**/api/account', (route) => route.fulfill({ json: guest }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with GitHub', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveCount(
    0,
  );
});

test('configured sign-in choices request only identity OAuth with local callbacks and never claim authentication before return', async ({
  page,
}) => {
  await page.route('**/api/account', (route) =>
    route.fulfill({ json: { ...guest, socialProviders: ['github', 'google'] } }),
  );
  const requests: unknown[] = [];
  await page.route('**/api/auth/sign-in/social', (route) => {
    const body = route.request().postDataJSON();
    expect(route.request().method()).toBe('POST');
    expect(body).toEqual({
      provider: body.provider,
      callbackURL: new URL('/?auth-callback=1', page.url()).href,
      errorCallbackURL: new URL('/?auth-callback=1', page.url()).href,
      disableRedirect: true,
    });
    expect(['github', 'google']).toContain(body.provider);
    requests.push(body);
    return route.fulfill({
      json: { url: destinations[body.provider as 'github' | 'google'], redirect: false },
    });
  });
  for (const url of Object.values(destinations))
    await page.route(url, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>OAuth fixture</title>' }),
    );
  for (const [provider, label] of [
    ['github', 'GitHub'],
    ['google', 'Google'],
  ] as const) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: `Continue with ${label}`, exact: true }).click();
    await expect(page).toHaveURL(destinations[provider]);
  }
  expect(requests).toHaveLength(2);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Your account', exact: true })).toHaveCount(0);
});

test('an existing owner links identities explicitly only after unlocking and shows links only after server confirmation', async ({
  page,
}) => {
  const account = {
    ...guest,
    user: {
      id: 'social-owner',
      name: 'Social Owner',
      email: 'owner@example.test',
      emailVerified: true,
      role: 'user',
      isWorldAdmin: false,
    },
    managedCharacterIds: ['hubert'],
    socialProviders: ['github', 'google'],
    linkedSocialProviders: ['github'],
    ownerControlsRequirePasskey: true,
    ownerControlsUnlocked: false,
    passkeyVerifiedRecently: false,
  };
  await page.route('**/api/account', (route) => route.fulfill({ json: account }));
  await page.route('**/api/auth/passkey/list-user-passkeys', (route) =>
    route.fulfill({
      json: [
        {
          id: 'owner-key',
          userId: 'social-owner',
          name: 'My key',
          createdAt: '2026-11-10T00:00:00Z',
        },
      ],
    }),
  );
  let links = 0;
  await page.route('**/api/auth/link-social', (route) => {
    links++;
    expect(route.request().postDataJSON()).toEqual({
      provider: 'google',
      callbackURL: new URL('/?auth-callback=1', page.url()).href,
      errorCallbackURL: new URL('/?auth-callback=1', page.url()).href,
      disableRedirect: true,
    });
    return route.fulfill({ json: { url: destinations.google, redirect: false } });
  });
  await page.route(destinations.google, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>OAuth fixture</title>' }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  let connections = page.getByRole('region', { name: 'Linked sign-in accounts', exact: true });
  await expect(connections).toContainText('GitHub · Linked');
  await expect(connections.getByRole('button', { name: 'Link GitHub', exact: true })).toHaveCount(
    0,
  );
  await expect(
    connections.getByRole('button', { name: 'Link Google', exact: true }),
  ).toBeDisabled();
  expect(links).toBe(0);
  account.ownerControlsUnlocked = true;
  account.passkeyVerifiedRecently = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(connections.getByRole('button', { name: 'Link Google', exact: true })).toBeEnabled();
  await connections.getByRole('button', { name: 'Link Google', exact: true }).click();
  await expect(page).toHaveURL(destinations.google);
  expect(links).toBe(1);
  await page.goto('/?auth-callback=1');
  connections = page.getByRole('region', { name: 'Linked sign-in accounts', exact: true });
  await expect(connections.getByRole('button', { name: 'Link Google', exact: true })).toBeVisible();
  await expect(connections).not.toContainText('Google · Linked');
  account.linkedSocialProviders.push('google');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(connections).toContainText('Google · Linked');
});

test('a same-email unlinked-provider return opens safe guidance without copying raw provider errors or joining accounts', async ({
  page,
}) => {
  await page.route('**/api/account', (route) =>
    route.fulfill({ json: { ...guest, socialProviders: ['github', 'google'] } }),
  );
  await page.goto(
    '/?auth-callback=1&error=account_not_linked&error_description=PRIVATE-PROVIDER-CANARY',
  );
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText(
    'Sign in with your existing method, then link this provider',
  );
  await expect(dialog).not.toContainText('CANARY');
  await expect(dialog).not.toContainText('You are signed in');
  await expect(
    dialog.getByRole('button', { name: 'Email me a sign-in link', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});
