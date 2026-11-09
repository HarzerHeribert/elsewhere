import { expect, test, type Page } from '@playwright/test';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { createInitialWorld, publicWorld } from '../../elsewhere/server/src/world';
import { createInitialHubert, publicCharacter } from '../../characters/hubert/src/index';

const epoch = Date.UTC(2026, 10, 9, 12);
function fixture(): PublicSnapshot {
  return {
    world: publicWorld(createInitialWorld(epoch)),
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
      simulatedAt: epoch,
      costUsd: 0,
      modelCalls: 0,
      simulationRate: 1,
    },
    notebook: { enabled: true, entries: [] },
  };
}
const panel = (page: Page) => page.getByLabel('World panel', { exact: true });
async function mountFixture(page: Page, state: PublicSnapshot) {
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
  const first = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/world' && r.status() === 200,
  );
  await page.goto('/');
  await first;
  await expect(page.getByRole('main', { name: 'Elsewhere game' })).toBeVisible();
  return mutations;
}
async function openNotebookThroughHubert(page: Page) {
  await page
    .getByRole('navigation', { name: 'World navigation' })
    .getByRole('button', { name: 'Residents', exact: true })
    .click();
  await panel(page).getByRole('button', { name: 'Select Hubert', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Hubert', exact: true })).toBeVisible();
  await expect(panel(page)).not.toContainText('TEMPLATE-THOUGHT-CANARY');
  await expect(panel(page)).not.toContainText('TEMPLATE-REFLECTION-CANARY');
  await panel(page).getByRole('button', { name: 'Notebook', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Notebook', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel(page).getByText('Hubert’s notebook', { exact: true })).toBeVisible();
}

test('Hubert’s notebook is discoverable and follows real snapshot draft changes through completion', async ({
  page,
}) => {
  const state = fixture();
  state.notebook!.entries = [
    {
      id: 'earlier',
      at: epoch,
      text: 'There are more shades of green here than I expected.',
      sourceIds: ['first-garden'],
    },
  ];
  const mutations = await mountFixture(page, state);
  await openNotebookThroughHubert(page);
  const earlier = panel(page).getByText(state.notebook!.entries[0].text, { exact: true });
  await expect(earlier).toBeVisible();
  await expect(panel(page).getByLabel('Notebook draft')).toHaveCount(0);

  state.runtime.tick++;
  state.notebook!.draft = { id: 'draft-one', at: epoch + 1_000, text: 'The shortest tube' };
  const draft = panel(page).getByLabel('Notebook draft');
  await expect(draft.getByRole('status')).toHaveText('Writing a note…');
  await expect(draft.locator('p')).toHaveText('The shortest tube');
  // A poll with unchanged data must not fabricate extra words or replay a typewriter animation.
  await page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/world' && r.status() === 200,
  );
  await expect(draft.locator('p')).toHaveText('The shortest tube');
  state.runtime.tick++;
  const full = 'The shortest tube makes a clear little sound. I wonder why its note arrives first.';
  state.notebook!.draft.text = full;
  await expect(draft.locator('p')).toHaveText(full);
  await expect(earlier).toBeVisible();
  state.runtime.tick++;
  state.notebook!.entries.push({
    id: 'finished',
    at: epoch + 2_000,
    text: full,
    sourceIds: ['observed-chime'],
  });
  delete state.notebook!.draft;
  await expect(panel(page).getByLabel('Notebook draft')).toHaveCount(0);
  await expect(panel(page).getByText(full, { exact: true })).toHaveCount(1);
  await expect(earlier).toBeVisible();
  await page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/world' && r.status() === 200,
  );
  await expect(panel(page).getByText(full, { exact: true })).toBeVisible();
  expect(mutations).toEqual([]);
});

test('empty notebook and hostile text remain honest, escaped and usable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = fixture(),
    mutations = await mountFixture(page, state);
  await openNotebookThroughHubert(page);
  await expect(
    panel(page).getByText(
      'His notebook is quiet for now. Notes appear when he has something to share.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel(page).locator('article')).toHaveCount(0);
  const hostile = '<img src=x onerror="window.NOTEBOOK_CODE_EXECUTED=true">';
  state.notebook!.draft = { id: 'unsafe-draft', at: epoch, text: hostile };
  state.runtime.tick++;
  await expect(panel(page).getByLabel('Notebook draft').locator('p')).toHaveText(hostile);
  expect(await page.evaluate(() => Object.hasOwn(window, 'NOTEBOOK_CODE_EXECUTED'))).toBe(false);
  await expect(panel(page).locator('img[src="x"]')).toHaveCount(0);
  state.notebook!.entries = [
    { id: 'unsafe-entry', at: epoch, text: hostile, sourceIds: ['source'] },
  ];
  delete state.notebook!.draft;
  state.runtime.tick++;
  await expect(panel(page).getByLabel('Notebook draft')).toHaveCount(0);
  await expect(panel(page).getByText(hostile, { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => Object.hasOwn(window, 'NOTEBOOK_CODE_EXECUTED'))).toBe(false);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await panel(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  expect(mutations).toEqual([]);
});
