import { expect, test, type Page } from '@playwright/test';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { createInitialWorld, publicWorld } from '../../elsewhere/server/src/world';
import { createInitialHubert, publicCharacter } from '../../characters/hubert/src/index';
import { settings } from './settings-fixture';

test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

// The navigation tree this walks. Every arrow is followed and then followed back.
//
//   World
//   ├─ Residents ─ Hubert ┬ Right now ──→ Messages · Activity · the place he is in
//   │                     ├ My notebook
//   │                     ├ My memories
//   │                     └ About me ───→ Wishes
//   ├─ Map ─ a place ─ an object        (a place ──→ the resident who is there)
//   ├─ Messages
//   ├─ Activity ─ a day ──→ a place · Hubert's page · Hubert's memories
//   ├─ Wishes
//   └─ Settings ─ a section             (closing returns to the panel it was opened over)
//
// On a phone, Activity, Wishes and Settings sit under More.

const minute = 60_000,
  hour = 60 * minute,
  started = Date.UTC(2026, 10, 8, 10),
  now = Date.UTC(2026, 10, 10, 12);
const long = (text: string) => (text + ' ').repeat(6).trim();
function fixture(): PublicSnapshot {
  const world = publicWorld(createInitialWorld(started));
  const place = world.places.find((item) => item.id !== 'meadow')!;
  return {
    world,
    character: publicCharacter(createInitialHubert(started)),
    events: [
      { id: 'e1', at: now - 26 * hour, type: 'arrival', message: 'Hubert arrived at the pond.' },
      {
        id: 'e2',
        at: now - 30 * minute,
        type: 'arrival',
        message: 'Hubert arrived in the orchard.',
      },
    ],
    // More than a panel holds, so a page is always taller than the space under its tabs.
    memories: Array.from({ length: 24 }, (_, i) => ({
      id: 'memory-' + i,
      at: now - (i < 6 ? i * 20 * minute : 25 * hour + i * minute),
      summary: long('Memory ' + i + ' of something by the water.'),
      cues: [],
      placeId: place.id,
    })),
    artifacts: [],
    wishes: [],
    recalledMemory: null,
    runtime: {
      mode: 'local',
      paused: true,
      tick: 0,
      startedAt: started,
      simulatedAt: now,
      costUsd: 0,
      modelCalls: 0,
      simulationRate: 1,
    },
    // Live-sized: several pursuits, each with many notes and open questions.
    pursuits: Array.from({ length: 6 }, (_, p) => ({
      id: 'pursuit-' + p,
      question: long('Why do the reeds lean, and which way (' + p + ')?'),
      why: long('I keep walking past them.'),
      status: p === 0 ? ('active' as const) : p === 5 ? ('set-aside' as const) : ('open' as const),
      openedAt: now - (60 - p) * hour,
      lastAt: now - p * hour,
      questions: Array.from({ length: 4 }, (_, q) => long('Open question ' + q + '?')),
      ...(p === 5 ? { setAsideReason: 'It stopped giving me anything.' } : {}),
      entries: [
        {
          kind: 'search' as const,
          id: 's' + p,
          at: now - p * hour,
          query: 'reed lean',
          sourceCount: 3,
        },
        ...Array.from({ length: 6 }, (_, n) => ({
          kind: 'note' as const,
          id: 'note-' + p + '-' + n,
          at: now - (p * 6 + n) * hour,
          text: long('Note ' + n + ' about how the rows of the orchard line up.'),
          surprised: n === 0,
          sourceIds: [],
        })),
      ],
    })),
    trail: Array.from({ length: 40 }, (_, i) => ({
      id: 'step-' + i,
      at: now - (40 - i) * 30 * minute,
      kind: (['pursue', 'search', 'read', 'note', 'move'] as const)[i % 5],
      why: i % 2 ? long('Because it matters.') : undefined,
      text: long('Step ' + i + ' of the trail.'),
      placeId: place.id,
    })),
  };
}
const panel = (page: Page) => page.getByLabel('World panel', { exact: true });
const menu = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'World navigation' })
    .getByRole('button', { name, exact: true })
    .click();
const title = (page: Page) => panel(page).locator('.panel-header h2');
const back = (page: Page, to: string) =>
  panel(page)
    .getByRole('button', { name: 'Back to ' + to, exact: true })
    .click();
const tab = (page: Page, name: string) =>
  panel(page).locator('.page-tabs').getByRole('button', { name, exact: true });
const scroller = (page: Page) => panel(page).locator('.panel-scroll');
async function mount(page: Page) {
  const state = fixture();
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
  return state.world.places.find((item) => item.id !== 'meadow')!;
}
async function openHubert(page: Page) {
  await menu(page, 'Residents');
  await panel(page).getByRole('button', { name: 'Select Hubert', exact: true }).click();
  await expect(title(page)).toHaveText('Hubert');
}

test('a resident’s pages stay in reach from each other, however long the page', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page);
  await openHubert(page);
  const order = [
    'My notebook',
    'My memories',
    'About me',
    'Right now',
    'About me',
    'My memories',
    'My notebook',
    'Right now',
  ];
  for (const name of order) {
    // From the very bottom of the page before it: the tabs are still there to be used.
    await scroller(page).evaluate((element) => (element.scrollTop = element.scrollHeight));
    await tab(page, name).click({ timeout: 3_000 });
    await expect(tab(page, name)).toHaveAttribute('aria-pressed', 'true');
    await expect(scroller(page)).toHaveJSProperty('scrollTop', 0);
    if (name === 'My notebook') {
      await scroller(page).evaluate((element) => (element.scrollTop = 600));
      await page.screenshot({ path: info.outputPath('pages-' + order.indexOf(name) + '.png') });
    }
  }
});

test('every link out of a panel leads back to exactly where it was followed from', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const place = await mount(page);

  // Residents ⇄ Hubert
  await openHubert(page);
  await back(page, 'Residents');
  await expect(title(page)).toHaveText('Residents');
  await panel(page).getByRole('button', { name: 'Select Hubert', exact: true }).click();

  // Hubert · About me ⇄ Wishes
  await tab(page, 'About me').click();
  await panel(page).getByRole('button', { name: 'My wishes' }).click();
  await expect(title(page)).toHaveText('Wishes');
  await back(page, 'Hubert');
  await expect(tab(page, 'About me')).toHaveAttribute('aria-pressed', 'true');

  // Hubert · Right now ⇄ Messages, Activity
  await tab(page, 'Right now').click();
  await panel(page).getByRole('button', { name: 'Message Hubert' }).click();
  await expect(title(page)).toHaveText('Messages');
  await page.screenshot({ path: info.outputPath('back-to-hubert.png') });
  await back(page, 'Hubert');
  await expect(tab(page, 'Right now')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('right-now.png') });
  await panel(page).getByRole('button', { name: 'See my whole day' }).click();
  await expect(title(page)).toHaveText('Activity');
  await back(page, 'Hubert');

  // Hubert ⇄ the place he is in ⇄ Hubert again, two steps deep and back out
  await panel(page).locator('.panel-subtitle').getByRole('button').click();
  const here = (await title(page).innerText()).trim();
  expect(here).not.toBe('Hubert');
  await panel(page).getByRole('button', { name: 'Hubert is here right now' }).click();
  await expect(title(page)).toHaveText('Hubert');
  await back(page, here);
  await expect(title(page)).toHaveText(here);
  await page.screenshot({ path: info.outputPath('place.png') });
  await back(page, 'Hubert');
  await expect(title(page)).toHaveText('Hubert');

  // Map ⇄ a place ⇄ an object
  await menu(page, 'Map');
  await panel(page).locator('.place-list button').first().click();
  const spot = (await title(page).innerText()).trim();
  await panel(page).locator('.object-list button').first().click();
  await expect(title(page)).not.toHaveText(spot);
  await back(page, spot);
  await expect(title(page)).toHaveText(spot);
  await back(page, 'Map');
  await expect(title(page)).toHaveText('Map');

  // Activity: an earlier day and a filter survive every trip away
  await menu(page, 'Activity');
  const day = panel(page).locator('.day-nav strong');
  await expect(day).toContainText('today');
  await panel(page)
    .getByRole('button', { name: /^My trail/ })
    .click();
  await page.screenshot({ path: info.outputPath('activity-trail.png') });
  await panel(page)
    .locator('.story-item')
    .getByRole('button', { name: place.name })
    .first()
    .click();
  await expect(title(page)).toHaveText(place.name);
  await back(page, 'Activity');
  await expect(panel(page).getByRole('button', { name: /^My trail/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel(page).getByRole('button', { name: 'All', exact: true }).click();
  await panel(page).locator('.day-nav button').first().click();
  await expect(day).not.toContainText('today');
  const yesterday = await day.innerText();
  await page.screenshot({ path: info.outputPath('story.png') });
  await panel(page).locator('.day-nav button').last().click();
  await expect(day).toContainText('today');
  await panel(page).getByRole('button', { name: 'Highlights', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Open my page' }).click();
  await expect(title(page)).toHaveText('Hubert');
  await back(page, 'Activity');
  await panel(page)
    .getByRole('button', { name: /more memor/ })
    .click();
  await expect(tab(page, 'My memories')).toHaveAttribute('aria-pressed', 'true');
  await back(page, 'Activity');
  await expect(title(page)).toHaveText('Activity');

  // Settings closes back to the panel it was opened over; the menu starts a fresh visit
  await menu(page, 'Settings');
  await expect(settings(page)).toBeVisible();
  await settings(page).getByRole('button', { name: 'Close settings' }).click();
  await expect(title(page)).toHaveText('Activity');
  await menu(page, 'Wishes');
  await expect(panel(page).getByRole('button', { name: /^Back to/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
});

test('on a phone every page is in reach and More is a step back, not a dead end', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page);
  await openHubert(page);
  for (const name of ['About me', 'My notebook', 'Right now', 'My memories']) {
    await tab(page, name).click({ timeout: 3_000 });
    await expect(tab(page, name)).toHaveAttribute('aria-pressed', 'true');
    await expect(tab(page, name)).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath('phone-pages.png') });
  await back(page, 'Residents');
  await expect(title(page)).toHaveText('Residents');

  await menu(page, 'More');
  for (const name of ['Activity', 'Wishes']) {
    await panel(page).getByRole('button', { name, exact: true }).click();
    await expect(title(page)).toHaveText(name);
    if (name === 'Activity') await page.screenshot({ path: info.outputPath('phone-activity.png') });
    await back(page, 'More');
    await expect(title(page)).toHaveText('More');
  }
  await panel(page).getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(settings(page)).toBeVisible();
  await settings(page).getByRole('button', { name: 'More', exact: true }).click();
  await expect(title(page)).toHaveText('More');
});
