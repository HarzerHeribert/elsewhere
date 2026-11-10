import { expect, test } from '@playwright/test';
import type { AccountResponse, PublicSnapshot } from '@elsewhere/character-interfaces';

const epoch = Date.UTC(2026, 10, 9, 12);
const ownerAccount = (): AccountResponse => ({
  user: {
    id: 'browser-character-owner',
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
    {
      id: 'decision-provider-failed',
      characterId: 'hubert',
      kind: 'failed',
      workload: 'decision',
      since: epoch,
      lastAt: epoch,
      message: 'Hubert’s decision provider failed. New decisions are waiting for your attention.',
    },
  ],
});

test('owner sees a persistent provider notice, retries it, and inspects research evidence', async ({
  page,
  request,
}, info) => {
  let world!: PublicSnapshot;
  await expect
    .poll(async () => {
      const response = await request.get('/api/world');
      if (!response.ok()) return false;
      world = (await response.json()) as PublicSnapshot;
      return true;
    })
    .toBe(true);
  world.character.activity = 'Currently unavailable';
  world.research = [
    {
      id: 'browser-research',
      at: epoch,
      topic: 'Robin behavior',
      query: 'European robin ground foraging',
      context: 'Following up on a robin encountered in Elsewhere.',
      status: 'read',
      sources: [
        {
          id: 'read-source',
          url: 'https://example.org/robin-study',
          title: 'Robin field study',
          snippet: 'A field study of robin behavior.',
          status: 'read',
          excerpt: 'The observed robin searched for invertebrates on the ground.',
          retrievedAt: epoch,
        },
        {
          id: 'unread-source',
          url: 'https://example.org/robin-overview',
          title: 'Robin overview',
          snippet: 'A second source returned by the search.',
          status: 'returned',
        },
      ],
      outcome: '1 of 2 sources read. Excerpts are source claims, not verified findings.',
      nextStep: 'No follow-up action has been recorded for this research.',
    },
  ];
  const account = ownerAccount();
  let retries = 0;
  await page.route('**/api/world', (route) => route.fulfill({ json: world }));
  await page.route('**/api/account', (route) => route.fulfill({ json: account }));
  await page.route('**/api/characters/hubert/provider/retry', async (route) => {
    expect(route.request().method()).toBe('POST');
    retries++;
    account.characterIssues![0].resolvedAt = epoch + 1000;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Elsewhere game' })).toBeVisible();
  await expect(page.getByLabel('Character needs attention', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const notices = dialog.getByRole('region', { name: 'Character provider notices' });
  await expect(notices).toContainText('Hubert · Needs attention');
  await expect(notices).toContainText('New decisions are waiting for your attention.');
  await page.screenshot({
    path: info.outputPath('owner-provider-notice.png'),
    animations: 'disabled',
  });
  await notices.getByRole('button', { name: 'Retry Hubert', exact: true }).click();
  await expect(notices).toContainText('No active character issues.');
  await expect(notices.getByText('Hubert · Recovered', { exact: true })).not.toBeVisible();
  await notices.locator('summary').filter({ hasText: 'Recovered issues' }).click();
  await expect(notices.getByText('Hubert · Recovered', { exact: true })).toBeVisible();
  await expect(notices.getByRole('button', { name: 'Retry Hubert', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Character needs attention', { exact: true })).toHaveCount(0);
  expect(retries).toBe(1);
  await dialog.getByRole('button', { name: 'Close account dialog', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'World navigation' })
    .getByRole('button', { name: 'Activity', exact: true })
    .click();
  const panel = page.getByLabel('World panel', { exact: true });
  const research = panel.getByRole('region', { name: 'Research history' });
  await research.locator('summary').filter({ hasText: 'Robin behavior' }).click();
  await expect(research).toContainText('European robin ground foraging');
  await expect(research.getByRole('link', { name: 'Robin field study' })).toHaveAttribute(
    'href',
    'https://example.org/robin-study',
  );
  await expect(research).toContainText('Search result · not read');
  await research.locator('summary').filter({ hasText: 'Source excerpt' }).click();
  await expect(research.locator('blockquote')).toHaveText(
    'The observed robin searched for invertebrates on the ground.',
  );
  await expect(research).toContainText('No follow-up action has been recorded');
  await page.screenshot({ path: info.outputPath('research-details.png'), animations: 'disabled' });
});

test('world administration alone does not expose character provider notices or retry controls', async ({
  page,
}) => {
  const account = ownerAccount();
  account.managedCharacterIds = [];
  account.user!.role = 'admin';
  account.user!.isWorldAdmin = true;
  await page.route('**/api/account', (route) => route.fulfill({ json: account }));
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Elsewhere game' })).toBeVisible();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('World admin');
  await expect(page.getByLabel('Character needs attention', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Character provider notices' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry Hubert', exact: true })).toHaveCount(0);
});
