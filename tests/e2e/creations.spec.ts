import { expect, test } from '@playwright/test';
import { closeSettings, openSettings } from './settings-fixture';
import type {
  AccountResponse,
  PublicCreation,
  PublicSnapshot,
} from '@elsewhere/character-interfaces';

const epoch = Date.UTC(2026, 10, 9, 12);
const ownerAccount: AccountResponse = {
  user: {
    id: 'creations-browser-owner',
    name: 'Creation Owner',
    email: 'owner@example.test',
    emailVerified: true,
    role: 'user',
    isWorldAdmin: false,
  },
  enabled: true,
  passwordAuthEnabled: true,
  requiresEmailVerification: true,
  managedCharacterIds: ['hubert'],
  characterIssues: [],
};

test('owner adds a creation link without pinning it, then explicitly pins it on the profile', async ({
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
  world.creations = [];
  world.artifacts = [
    {
      id: 'weather-study',
      name: 'LEGACY-WEATHER-CANARY',
      description: 'Prototype chart',
      url: '/api/artifacts/weather-study',
      createdAt: epoch,
    },
  ];
  let additions = 0,
    pins = 0;
  await page.route('**/api/world', (route) => route.fulfill({ json: world }));
  await page.route('**/api/account', (route) => route.fulfill({ json: ownerAccount }));
  await page.route('**/api/characters/hubert/creations', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON();
    expect(body).toEqual({
      title: 'Orchard field guide',
      description: 'A guide to birds observed in Elsewhere.',
      url: 'https://github.com/example/orchard-guide',
      kind: 'repository',
    });
    additions++;
    const creation: PublicCreation = {
      id: 'creation-browser-guide',
      characterId: 'hubert',
      ...body,
      createdAt: epoch,
      provenance: 'owner',
    };
    world.creations!.push(creation);
    await route.fulfill({ json: { creation } });
  });
  await page.route(
    '**/api/characters/hubert/creations/creation-browser-guide/pin',
    async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ pinned: true });
      pins++;
      world.creations![0].pinnedAt = epoch + 1000;
      await route.fulfill({ json: { accepted: true } });
    },
  );
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Elsewhere game' })).toBeVisible();
  const account = await openSettings(page, 'Creations');
  const manager = account.getByRole('region', { name: 'Manage creations' });
  await expect(manager).toBeVisible();
  await manager.getByLabel('Title', { exact: true }).fill('Orchard field guide');
  await manager
    .getByLabel('Link', { exact: true })
    .fill('https://github.com/example/orchard-guide');
  await manager
    .getByLabel('Description', { exact: true })
    .fill('A guide to birds observed in Elsewhere.');
  await manager.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(manager).toContainText('Owner-added link');
  await expect(manager.getByRole('button', { name: 'Pin creation', exact: true })).toBeVisible();
  expect(world.creations![0].pinnedAt).toBeUndefined();
  expect(pins).toBe(0);
  await manager.getByRole('button', { name: 'Pin creation', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Unpin creation', exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath('owner-creation-manager.png'),
    animations: 'disabled',
  });
  expect(additions).toBe(1);
  expect(pins).toBe(1);
  await closeSettings(page);
  await page
    .getByRole('navigation', { name: 'World navigation' })
    .getByRole('button', { name: 'Residents', exact: true })
    .click();
  await page.getByRole('button', { name: 'Select Hubert', exact: true }).click();
  await page.getByRole('button', { name: 'About me', exact: true }).click();
  const shelf = page.getByRole('region', { name: 'Hubert’s creations' });
  await expect(shelf.getByRole('link', { name: /Orchard field guide/ })).toHaveAttribute(
    'href',
    'https://github.com/example/orchard-guide',
  );
  await expect(shelf).toContainText('Owner-added link');
  await expect(page.getByText('LEGACY-WEATHER-CANARY', { exact: true })).toHaveCount(0);
  await shelf.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('pinned-creation-profile.png'),
    animations: 'disabled',
  });
});

test('the public profile does not auto-promote legacy artifacts or unpinned creations', async ({
  page,
  request,
}) => {
  let world!: PublicSnapshot;
  await expect
    .poll(async () => {
      const response = await request.get('/api/world');
      if (!response.ok()) return false;
      world = (await response.json()) as PublicSnapshot;
      return true;
    })
    .toBe(true);
  world.artifacts = [
    {
      id: 'weather-study',
      name: 'LEGACY-WEATHER-CANARY',
      description: 'Prototype chart',
      url: '/api/artifacts/weather-study',
      createdAt: epoch,
    },
  ];
  world.creations = [
    {
      id: 'unselected-guide',
      characterId: 'hubert',
      title: 'An unpinned guide',
      description: 'Still a draft',
      url: 'https://example.com/draft-guide',
      kind: 'document',
      createdAt: epoch,
      provenance: 'character',
    },
  ];
  await page.route('**/api/world', (route) => route.fulfill({ json: world }));
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'World navigation' })
    .getByRole('button', { name: 'Residents', exact: true })
    .click();
  await page.getByRole('button', { name: 'Select Hubert', exact: true }).click();
  await page.getByRole('button', { name: 'About me', exact: true }).click();
  const shelf = page.getByRole('region', { name: 'Hubert’s creations' });
  await expect(shelf).toContainText('No creations pinned yet.');
  await expect(page.getByText('LEGACY-WEATHER-CANARY', { exact: true })).toHaveCount(0);
  await expect(shelf.getByRole('link', { name: /An unpinned guide/ })).toHaveCount(0);
  await shelf.locator('summary').filter({ hasText: 'More creations' }).click();
  await expect(shelf.getByRole('link', { name: /An unpinned guide/ })).toBeVisible();
});
