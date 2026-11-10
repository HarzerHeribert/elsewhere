import { expect, test } from '@playwright/test';
import { closeSettings, openSettings } from './settings-fixture';
import type { AccountResponse, PublicSnapshot } from '@elsewhere/character-interfaces';
import type { AccountCharacterMail } from '../../characters/interfaces/src/mail';
const publicMail = {
  characterId: 'hubert',
  name: 'Hubert',
  address: 'hubert@elswhr.dev',
  receiving: 'pending' as const,
  sendingAvailable: true,
};
const subscribedMail = (): AccountCharacterMail => ({
  ...publicMail,
  preferences: { newsletter: false, correspondence: false },
  canSubscribe: true,
});
const member = (characterMail: AccountCharacterMail[], manages = false): AccountResponse => ({
  user: {
    id: manages ? 'mail-owner' : 'mail-reader',
    name: manages ? 'Mail Owner' : 'Mail Reader',
    email: 'member@example.com',
    emailVerified: true,
    role: 'user',
    isWorldAdmin: false,
  },
  enabled: true,
  passwordAuthEnabled: true,
  requiresEmailVerification: true,
  managedCharacterIds: manages ? ['hubert'] : [],
  characterIssues: [],
  characterMail,
});

test('a verified member independently subscribes to Hubert and sees truthful pending receiving status', async ({
  page,
  request,
}, info) => {
  let world!: PublicSnapshot;
  await expect
    .poll(async () => {
      const response = await request.get('/api/world');
      if (!response.ok()) return false;
      world = await response.json();
      return true;
    })
    .toBe(true);
  world.mail = publicMail;
  const mail = subscribedMail();
  await page.route('**/api/world', (route) => route.fulfill({ json: world }));
  await page.route('**/api/account', (route) => route.fulfill({ json: member([mail]) }));
  let updates = 0;
  await page.route('**/api/characters/hubert/mail/preferences', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ newsletter: true, correspondence: false });
    updates++;
    mail.preferences.newsletter = true;
    await route.fulfill({ json: mail.preferences });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Residents', exact: true }).click();
  await page.getByRole('button', { name: 'Select Hubert', exact: true }).click();
  await page.getByRole('button', { name: 'About me', exact: true }).click();
  const prefs = page.getByRole('region', { name: 'Emails from Hubert' });
  await expect(prefs).toContainText('hubert@elswhr.dev');
  await expect(prefs).toContainText('Receiving is being verified');
  await expect(
    prefs.getByRole('checkbox', { name: 'Receive Hubert’s newsletter' }),
  ).not.toBeChecked();
  await prefs.getByRole('checkbox', { name: 'Receive Hubert’s newsletter' }).check();
  await expect(prefs.getByRole('checkbox', { name: 'Receive Hubert’s newsletter' })).toBeChecked();
  await expect(
    prefs.getByRole('checkbox', { name: 'Allow personal emails from Hubert' }),
  ).not.toBeChecked();
  expect(updates).toBe(1);
  await prefs.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('character-mail-preferences.png') });
});

test('only the character owner sees draft review and can approve a newsletter', async ({
  page,
  request,
}, info) => {
  let world!: PublicSnapshot;
  await expect
    .poll(async () => {
      const response = await request.get('/api/world');
      if (!response.ok()) return false;
      world = await response.json();
      return true;
    })
    .toBe(true);
  world.mail = publicMail;
  const mail = subscribedMail();
  mail.owner = {
    publication: 'review',
    drafts: [
      {
        id: 'draft-browser-note',
        characterId: 'hubert',
        kind: 'newsletter',
        subject: 'The birds around the courtyard',
        text: 'A small observation for my subscribers.',
        createdAt: Date.UTC(2026, 10, 10),
        source: 'character',
        status: 'awaiting_approval',
      },
    ],
    inbox: [],
    deliveries: [],
    subscriberCount: 3,
    contacts: [{ id: 'reader-1', name: 'A consenting reader' }],
  };
  await page.route('**/api/world', (route) => route.fulfill({ json: world }));
  let owns = true;
  await page.route('**/api/account', (route) =>
    route.fulfill({
      json: {
        ...member([mail], owns),
        user: { ...member([mail], owns).user!, isWorldAdmin: !owns },
      },
    }),
  );
  let approvals = 0;
  await page.route(
    '**/api/characters/hubert/mail/drafts/draft-browser-note/approve',
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({});
      approvals++;
      mail.owner!.drafts[0].status = 'queued';
      await route.fulfill({ json: { accepted: true } });
    },
  );
  await page.goto('/');
  await openSettings(page, 'Mail');
  const mailbox = page.getByRole('region', { name: 'Hubert mailbox' });
  await expect(mailbox).toContainText('Receiving pending verification');
  await expect(mailbox).toContainText('3 newsletter subscribers');
  await expect(mailbox).toContainText('The birds around the courtyard');
  await mailbox.getByRole('button', { name: 'Approve and send' }).click();
  await expect(mailbox).toContainText('Email approved for delivery');
  await expect(mailbox.getByRole('button', { name: 'Approve and send' })).toHaveCount(0);
  expect(approvals).toBe(1);
  await mailbox.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('owner-mailbox.png') });
  owns = false;
  await page.reload();
  await openSettings(page, 'Mail');
  await expect(page.getByRole('region', { name: 'Hubert mailbox' })).toHaveCount(0);
});

test('mail stays readable under owner lock while sending waits for passkey and email verification', async ({
  page,
  request,
}, info) => {
  const response = await request.get('/api/world');
  expect(response.ok()).toBe(true);
  const world = (await response.json()) as PublicSnapshot;
  world.mail = publicMail;
  const mail = subscribedMail();
  mail.owner = {
    publication: 'review',
    subscriberCount: 1,
    contacts: [],
    drafts: [
      {
        id: 'locked-draft',
        characterId: 'hubert',
        kind: 'newsletter',
        subject: 'A pending observation',
        text: 'A notebook observation.',
        source: 'character',
        createdAt: Date.UTC(2026, 10, 10),
        status: 'awaiting_approval',
      },
    ],
    inbox: [
      {
        id: 'private-letter',
        characterId: 'hubert',
        senderName: 'A visitor',
        subject: 'A visitor letter',
        text: 'Private mail stays readable.',
        receivedAt: Date.UTC(2026, 10, 10),
        trust: 'external',
      },
    ],
    deliveries: [],
  };
  const account: AccountResponse = {
    ...member([mail], true),
    passkeyAuthEnabled: true,
    ownerControlsRequirePasskey: true,
    ownerControlsUnlocked: false,
    passkeyVerifiedRecently: false,
  };
  await page.route('**/api/world', (route) => route.fulfill({ json: world }));
  await page.route('**/api/account', (route) => route.fulfill({ json: account }));
  await page.route('**/api/auth/passkey/list-user-passkeys', (route) =>
    route.fulfill({
      json: [
        {
          id: 'owner-key',
          userId: 'mail-owner',
          name: 'My passkey',
          createdAt: '2026-11-10T00:00:00Z',
        },
      ],
    }),
  );
  let preferences = 0,
    approvals = 0,
    compositions = 0;
  await page.route('**/api/characters/hubert/mail/preferences', (route) => {
    preferences++;
    mail.preferences = route.request().postDataJSON();
    return route.fulfill({ json: mail.preferences });
  });
  await page.route('**/api/characters/hubert/mail/drafts', (route) => {
    compositions++;
    return route.fulfill({ json: { accepted: true } });
  });
  await page.route('**/api/characters/hubert/mail/drafts/locked-draft/approve', (route) => {
    approvals++;
    mail.owner!.drafts[0].status = 'queued';
    return route.fulfill({ json: { accepted: true } });
  });
  await page.goto('/');
  await openSettings(page, 'Mail');
  const mailbox = page.getByRole('region', { name: 'Hubert mailbox' });
  const prefs = page.getByRole('region', { name: 'Emails from Hubert' });
  await expect(mailbox).toContainText('Verify a passkey before writing or sending');
  await expect(
    mailbox.getByRole('button', { name: 'Approve and send', exact: true }),
  ).toBeDisabled();
  await mailbox.locator('summary').filter({ hasText: 'Write an email' }).click();
  await expect(mailbox.getByLabel('Subject', { exact: true })).toBeDisabled();
  await mailbox.locator('summary').filter({ hasText: 'Private inbox' }).click();
  await expect(mailbox.getByText('Private mail stays readable.', { exact: true })).toBeVisible();
  await prefs.getByRole('checkbox', { name: 'Receive Hubert’s newsletter', exact: true }).check();
  await expect(
    prefs.getByRole('checkbox', { name: 'Receive Hubert’s newsletter', exact: true }),
  ).toBeChecked();
  expect(preferences).toBe(1);
  expect(approvals).toBe(0);
  expect(compositions).toBe(0);
  await mailbox.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('passkey-locked-mailbox.png'),
    animations: 'disabled',
  });

  account.ownerControlsUnlocked = true;
  account.passkeyVerifiedRecently = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(mailbox.getByLabel('Subject', { exact: true })).toBeEnabled();
  await expect(
    mailbox.getByRole('button', { name: 'Approve and send', exact: true }),
  ).toBeEnabled();
  await mailbox.getByRole('button', { name: 'Approve and send', exact: true }).click();
  await expect(mailbox).toContainText('Email approved for delivery.');
  expect(approvals).toBe(1);
  expect(compositions).toBe(0);

  account.user!.emailVerified = false;
  mail.owner!.drafts[0].status = 'awaiting_approval';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(mailbox).toContainText('Verify your account email before writing or sending');
  await expect(
    mailbox.getByRole('button', { name: 'Approve and send', exact: true }),
  ).toBeDisabled();
  await expect(mailbox.getByLabel('Subject', { exact: true })).toBeDisabled();
  await expect(prefs).toContainText('Verify your email address to subscribe.');
  await expect(prefs.getByRole('checkbox')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mailbox.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('unverified-mailbox-mobile.png'),
    animations: 'disabled',
  });
  expect(approvals).toBe(1);
  expect(compositions).toBe(0);
});

test('a mail lookup outage keeps account and passkey controls available and does not invent preference state', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/world');
  expect(response.ok()).toBe(true);
  const world = (await response.json()) as PublicSnapshot;
  world.mail = publicMail;
  const account: AccountResponse = {
    ...member([], true),
    passkeyAuthEnabled: true,
    characterMailUnavailable: true,
  };
  await page.route('**/api/world', (route) => route.fulfill({ json: world }));
  await page.route('**/api/account', (route) => route.fulfill({ json: account }));
  await page.route('**/api/auth/passkey/list-user-passkeys', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  const dialog = await openSettings(page, 'Account');
  await expect(dialog).toContainText('You are signed in as Mail Owner.');
  await openSettings(page, 'Mail');
  await expect(dialog).toContainText('Character mail is temporarily unavailable.');
  await openSettings(page, 'Sign-in & security');
  await expect(
    dialog
      .getByRole('region', { name: 'Account passkeys' })
      .getByRole('button', { name: 'Add a passkey', exact: true }),
  ).toBeEnabled();
  await openSettings(page, 'Creations');
  await expect(dialog.getByRole('region', { name: 'Manage creations' })).toBeVisible();
  await closeSettings(page);
  await page.getByRole('button', { name: 'Residents', exact: true }).click();
  await page.getByRole('button', { name: 'Select Hubert', exact: true }).click();
  await page.getByRole('button', { name: 'About me', exact: true }).click();
  const preferences = page.getByRole('region', { name: 'Emails from Hubert' });
  await expect(preferences).toContainText('Your email preferences are unavailable right now.');
  await expect(preferences.getByRole('checkbox')).toHaveCount(0);
  await openSettings(page, 'Mail');
  delete account.characterMailUnavailable;
  account.characterMail = [subscribedMail()];
  await dialog.getByRole('button', { name: 'Reload mail', exact: true }).click();
  await expect(dialog).not.toContainText('Character mail is temporarily unavailable.');
  await expect(
    dialog
      .getByRole('region', { name: 'Emails from Hubert' })
      .getByRole('checkbox', { name: 'Receive Hubert’s newsletter', exact: true }),
  ).toBeVisible();
});
