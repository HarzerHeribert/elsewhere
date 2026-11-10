import { expect, test, type Page } from '@playwright/test';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { createInitialWorld, publicWorld } from '../../elsewhere/server/src/world';
import { createInitialHubert, publicCharacter } from '../../characters/hubert/src/index';
import { openSettings } from './settings-fixture';

const epoch = Date.UTC(2026, 10, 9, 12),
  now = epoch + 2 * 3_600_000;
function fixture(): PublicSnapshot {
  const world = publicWorld(createInitialWorld(epoch));
  const place = world.places.find((item) => item.id !== 'meadow')!;
  return {
    world,
    character: {
      ...publicCharacter(createInitialHubert(epoch)),
      currentThought: 'TEMPLATE-THOUGHT-CANARY',
      lastReflection: 'TEMPLATE-REFLECTION-CANARY',
    },
    events: [],
    memories: [],
    artifacts: [],
    wishes: [],
    recalledMemory: null,
    runtime: {
      mode: 'local',
      paused: true,
      tick: 0,
      startedAt: epoch,
      simulatedAt: now,
      costUsd: 0,
      modelCalls: 0,
      simulationRate: 1,
    },
    notebook: {
      enabled: true,
      entries: [
        {
          id: 'note-1',
          at: now - 50 * 60_000,
          text: 'The reeds lean the same way every morning.',
          sourceIds: ['memory:one'],
          topics: [
            { kind: 'place', id: place.id, label: place.name },
            { kind: 'reading', id: 'https://example.org/reeds', label: 'Reeds and wind' },
            { kind: 'reading', id: 'javascript:alert(1)', label: 'Unsafe source' },
          ],
        },
      ],
    },
    thoughts: {
      available: true,
      enabled: true,
      entries: [
        { id: 't1', at: now - 90 * 60_000, text: 'The path is longer than it looks.' },
        {
          id: 't2',
          at: now - 40 * 60_000,
          text: 'I like how quiet it gets here.',
          placeId: place.id,
        },
        {
          id: 't3',
          at: now - 4 * 60_000,
          text: 'Why do the reeds <b>lean</b> one way?',
          placeId: place.id,
        },
      ],
    },
    research: [
      {
        id: 'reading-episode',
        at: now - 10 * 60_000,
        topic: 'Common reed',
        query: 'common reed wind lean',
        context: 'Following up on reeds encountered in Elsewhere.',
        status: 'reading',
        readingSourceId: 'source-b',
        sources: [
          {
            id: 'source-a',
            url: 'https://example.org/a',
            title: 'Reed beds',
            snippet: 'About reed beds.',
            status: 'returned',
          },
          {
            id: 'source-b',
            url: 'https://example.org/b',
            title: 'Wind and stems',
            snippet: 'About stems in wind.',
            status: 'returned',
          },
        ],
      },
    ],
  };
}
const panel = (page: Page) => page.getByLabel('World panel', { exact: true });
const navigate = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'World navigation' })
    .getByRole('button', { name, exact: true })
    .click();
async function mount(page: Page, state: PublicSnapshot) {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/') &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())
    )
      mutations.push(request.method() + ' ' + new URL(request.url()).pathname);
  });
  await page.route('**/api/world', (route) => route.fulfill({ json: state }));
  await page.route('**/api/account', (route) =>
    route.fulfill({
      json: {
        enabled: false,
        passwordAuthEnabled: false,
        requiresEmailVerification: true,
        user: null,
        managedCharacterIds: [],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Elsewhere game' })).toBeVisible();
  return mutations;
}

test('shared thoughts appear beside Hubert, on his page and in the day, always as plain text', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mutations = await mount(page, fixture());
  const latest = 'Why do the reeds <b>lean</b> one way?';

  // In the world: one bubble over the resident, inside the stage, that never takes the pointer.
  const bubble = page.locator('.thought-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveText(latest);
  await expect(bubble.locator('b')).toHaveCount(0);
  await expect(bubble).toHaveCSS('pointer-events', 'none');
  const stage = (await page.locator('.scene-canvas').boundingBox())!,
    box = (await bubble.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(stage.x);
  expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(box.width).toBeLessThanOrEqual(240);
  await page.screenshot({ path: info.outputPath('thought-world.png') });

  // On his page: the current thought stands on its own, earlier ones lead up to it.
  await navigate(page, 'Residents');
  await panel(page).getByRole('button', { name: 'Select Hubert', exact: true }).click();
  const thinking = panel(page).getByRole('figure', { name: 'What I’m thinking' });
  await expect(thinking).toContainText(latest);
  await expect(thinking.locator('b')).toHaveCount(0);
  await expect(panel(page)).toContainText('I like how quiet it gets here.');
  await expect(panel(page)).not.toContainText('TEMPLATE-THOUGHT-CANARY');
  await expect(panel(page)).not.toContainText('TEMPLATE-REFLECTION-CANARY');
  await page.screenshot({ path: info.outputPath('thought-now.png') });

  // A note says what it drew on; an unsafe address is never a link.
  await panel(page).getByRole('button', { name: 'My notebook', exact: true }).click();
  const topics = panel(page).getByRole('list', { name: 'What this note is about' });
  await expect(topics.getByRole('link', { name: /Reeds and wind/ })).toHaveAttribute(
    'href',
    'https://example.org/reeds',
  );
  await expect(topics.getByRole('link')).toHaveCount(1);
  await expect(topics.getByRole('button')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('note-topics.png') });

  // Research names the source being read at this moment.
  await panel(page).getByRole('button', { name: 'My research', exact: true }).click();
  await panel(page)
    .getByRole('button', { name: /Common reed/ })
    .click();
  const research = panel(page).getByRole('article', { name: 'Research: Common reed' });
  await expect(research.locator('.source-row.reading')).toContainText('Wind and stems');
  await expect(research.locator('.source-row.reading')).toContainText('Reading now');
  await expect(research.locator('.source-status', { hasText: 'Reading now' })).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('reading-now.png') });

  // In the day's story: a filter of their own, and the current one on the Right now card.
  await navigate(page, 'Activity');
  await expect(panel(page).getByRole('region', { name: 'Right now' })).toContainText(latest);
  await panel(page).getByRole('button', { name: 'Thoughts · 3', exact: true }).click();
  await expect(panel(page).locator('.story-item.thought')).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('thought-activity.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page).locator('.story-item.thought')).toHaveCount(3);
  await expect(page.locator('nav.world-tabbar')).toBeVisible();
  await expect.poll(() => panel(page).evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.screenshot({ path: info.outputPath('thought-phone.png') });
  expect(mutations).toEqual([]);
});

test('nothing about thoughts is shown when they are not shared', async ({ page }) => {
  const state = fixture();
  state.thoughts = { available: true, enabled: false, entries: [] };
  await mount(page, state);
  await navigate(page, 'Activity');
  await expect(panel(page).getByRole('button', { name: 'Highlights', exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: /^Thoughts/ })).toHaveCount(0);
  await expect(page.locator('.thought-bubble')).toBeHidden();
});

test('the owner can stop and resume sharing thoughts from World settings', async ({ page }) => {
  const state = fixture();
  await page.route('**/api/world', (route) => route.fulfill({ json: state }));
  await page.route('**/api/account', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'thoughts-owner',
          name: 'Thought Owner',
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
      },
    }),
  );
  const asked: string[] = [];
  await page.route('**/api/admin/thoughts-*', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop()!;
    expect(route.request().postDataJSON()).toEqual({});
    asked.push(action);
    state.thoughts = { ...state.thoughts!, enabled: action === 'thoughts-on' };
    await route.fulfill({ json: state });
  });
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Elsewhere game' })).toBeVisible();
  await expect(page.locator('.thought-bubble')).toBeVisible();
  const region = (await openSettings(page, 'World')).getByRole('region', {
    name: 'Shared thoughts',
  });
  await expect(region).toContainText('Shared with visitors');
  await region.getByRole('button', { name: 'Stop sharing thoughts', exact: true }).click();
  await expect(region).toContainText('Not shared');
  await region.getByRole('button', { name: 'Share thoughts', exact: true }).click();
  await expect(region).toContainText('Shared with visitors');
  expect(asked).toEqual(['thoughts-off', 'thoughts-on']);
});
