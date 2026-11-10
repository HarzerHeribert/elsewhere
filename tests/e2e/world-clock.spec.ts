import { expect, test, type Page } from '@playwright/test';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { createInitialWorld, publicWorld } from '../../elsewhere/server/src/world';
import { createInitialHubert, publicCharacter } from '../../characters/hubert/src/index';

test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

// The world started on 8 November, ran for a day in all and stood still for 26.5 hours of
// pauses. Its own clock reads 9 November 07:09 UTC; the real time is 10 November 09:38 UTC.
const minute = 60_000,
  started = Date.UTC(2026, 10, 8, 10, 36),
  worldNow = Date.UTC(2026, 10, 9, 7, 9),
  realNow = Date.UTC(2026, 10, 10, 9, 38);
function fixture(): PublicSnapshot {
  return {
    world: publicWorld(createInitialWorld(started)),
    character: publicCharacter(createInitialHubert(started)),
    events: [
      {
        id: 'event-1',
        at: worldNow - 4 * minute,
        type: 'arrival',
        message: 'Hubert arrived in the orchard.',
      },
    ],
    memories: [
      {
        id: 'memory-1',
        at: worldNow - 3 * 60 * minute,
        summary: 'A robin sang by the pond.',
        cues: [],
      },
    ],
    artifacts: [],
    wishes: [],
    recalledMemory: null,
    runtime: {
      mode: 'local',
      paused: false,
      tick: 34_000,
      startedAt: started,
      simulatedAt: worldNow,
      // The clock last started moving again twenty minutes ago.
      clock: [{ at: worldNow - 20 * minute, wall: realNow - 20 * minute }],
      costUsd: 0,
      modelCalls: 0,
      simulationRate: 1,
    },
    notebook: {
      enabled: true,
      entries: [
        {
          id: 'note-1',
          at: worldNow - 5 * minute,
          text: 'The orchard rows look longer in the morning.',
          sourceIds: ['memory:one'],
        },
      ],
    },
  };
}
const panel = (page: Page) => page.getByLabel('World panel', { exact: true });
const navigate = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'World navigation' })
    .getByRole('button', { name, exact: true })
    .click();
async function mount(page: Page) {
  await page.route('**/api/world', (route) => route.fulfill({ json: fixture() }));
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
}

test('the world shows real dates and times in the visitor’s timezone', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page);

  // 09:38 UTC is 10:38 in Berlin. The world clock's own 08:09 never appears.
  const clock = page.locator('.world-clock .world-day');
  await expect(clock).toContainText(/Tue,? 10 Nov/);
  await expect(clock).toContainText('10:38');
  await expect(page.getByText(/Day 0\d/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('clock-world.png') });

  await navigate(page, 'Activity');
  await expect(panel(page).locator('.day-nav strong')).toHaveText(/Tue,? 10 Nov · today/);
  await expect(panel(page)).toContainText('10:33'); // The note, five minutes ago.
  await expect(panel(page)).not.toContainText('08:0');
  await page.screenshot({ path: info.outputPath('clock-activity.png') });

  await navigate(page, 'Residents');
  await panel(page).getByRole('button', { name: 'Select Hubert', exact: true }).click();
  await panel(page).getByRole('button', { name: 'My notebook', exact: true }).click();
  await expect(panel(page).locator('.day-rule')).toHaveText(/Tue,? 10 Nov/);
  await page.screenshot({ path: info.outputPath('clock-notebook.png') });
  await panel(page).getByRole('button', { name: 'My memories', exact: true }).click();
  await expect(panel(page).locator('.memory-row time')).toContainText('10 Nov');
  await expect(panel(page).locator('.memory-row time')).toContainText('07:38');
  await page.screenshot({ path: info.outputPath('clock-memories.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.phone-top .world-day')).toContainText('10:38');
  await page.screenshot({ path: info.outputPath('clock-phone.png') });
});
