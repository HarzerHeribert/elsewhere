import { expect, test, type Page } from '@playwright/test';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { createInitialWorld, publicWorld } from '../../elsewhere/server/src/world';
import { createInitialHubert, publicCharacter } from '../../characters/hubert/src/index';
import { settings, visitPage } from './settings-fixture';

test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

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
    // Live-sized: several rewordings of one question worked at one object, each with many
    // readings, notes and open questions, and one unrelated question beside them.
    pursuits: Array.from({ length: 7 }, (_, p) => ({
      id: 'pursuit-' + p,
      question:
        p === 6
          ? 'What keeps the heron so still by the water?'
          : p === 2
            ? 'Whydothereedsleanandwhichwaydotheylean'.repeat(6) + '?'
            : long('Why do the reeds lean, and which way (' + p + ')?'),
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
        ...(p === 6
          ? []
          : Array.from({ length: 12 }, (_, n) => ({
              kind: 'tried' as const,
              id: 'tried-' + p + '-' + n,
              at: now - (p * 6 + n) * hour - minute,
              text:
                'Tried release 2 on the pendulum stand. Released from 2 degrees with the ' +
                50 * ((n % 3) + 1) +
                ' g bob on 80 cm of cord, ten full swings took 17.9' +
                (n % 10) +
                ' s, and after ' +
                (50 + n) +
                ' swings the swing had shrunk to half.',
              objectId: 'artifact',
            }))),
        ...(p === 1
          ? [
              {
                kind: 'made' as const,
                id: 'made-1',
                at: now - 2 * hour,
                creationId: 'creation-1',
                path: 'notes/pendulum-mass-and-decay-at-three-cord-lengths.html',
                title: long('Pendulum mass and decay'),
                url: 'https://example.org/notes/pendulum-mass-decay.html',
                commitSha: 'abc',
              },
            ]
          : []),
      ],
    })),
    trail: Array.from({ length: 40 }, (_, i) => ({
      id: 'step-' + i,
      at: now - (40 - i) * 30 * minute,
      kind: (['pursue', 'search', 'read', 'note', 'move', 'use'] as const)[i % 6],
      why: i % 2 ? long('Because it matters.') : undefined,
      pursuitId: 'pursuit-' + (Math.floor(i / 6) % 2),
      text:
        i % 6 === 5
          ? 'Released from 2 degrees with the 100 g bob on 80 cm of cord, ten full swings took 17.98 s, and after 64 swings the swing had shrunk to half.'
          : long('Step ' + i + ' of the trail.'),
      placeId: place.id,
    })),
  };
}
const panel = (page: Page) => page.getByLabel('World panel', { exact: true });
const menu = visitPage;
const title = (page: Page) => panel(page).locator('.panel-header h2');
const back = (page: Page, to: string) =>
  panel(page)
    .getByRole('button', { name: 'Back to ' + to, exact: true })
    .click();
const tab = (page: Page, name: string) =>
  panel(page)
    .locator('.page-tabs, .resident-index, .resident-shortcuts')
    .getByRole('button', { name: name === 'About' ? /^About(?: Hubert)?$/ : name, exact: true });
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
    'Notebook',
    'Memories',
    'About',
    'Activity',
    'About',
    'Memories',
    'Notebook',
    'Activity',
  ];
  for (const name of order) {
    // From the very bottom of the page before it: the tabs are still there to be used.
    await scroller(page).evaluate((element) => (element.scrollTop = element.scrollHeight));
    await tab(page, name).click({ timeout: 3_000 });
    await expect(tab(page, name)).toHaveAttribute('aria-pressed', 'true');
    await expect(scroller(page)).toHaveJSProperty('scrollTop', 0);
    if (name === 'Notebook') {
      await scroller(page).evaluate((element) => (element.scrollTop = 600));
      await page.screenshot({ path: info.outputPath('pages-' + order.indexOf(name) + '.png') });
    }
  }
});

for (const [device, width, height] of [
  ['a desktop', 1440, 900],
  ['a phone', 390, 844],
] as const)
  test(`on ${device} a resident’s profile opens its activity, in one order, with every line inside the panel`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await mount(page);
    await openHubert(page);
    await expect(panel(page).locator('.resident-intro h3')).toHaveText('Hubert');
    await tab(page, 'Activity').click();
    const rightNow = panel(page).getByRole('region', { name: 'Right now' });
    const question = panel(page).getByRole('region', { name: 'The question I’m on' });
    await expect(rightNow).toBeVisible();
    await page.screenshot({ path: info.outputPath('right-now-top.png') });

    // Nothing but the tabs sits above what he is doing now; the question follows it.
    const tabs = (await panel(page).locator('.page-tabs').boundingBox())!;
    const lead = (await rightNow.boundingBox())!;
    expect(lead.y - (tabs.y + tabs.height)).toBeLessThan(40);
    expect((await question.boundingBox())!.y).toBeGreaterThan(lead.y + lead.height);

    // One question leads; its rewordings are folded under it, the unrelated one is kept apart.
    await expect(question.locator('.question-title')).toHaveCount(1);
    await expect(question.locator('.question-kin > summary').first()).toHaveText(
      'One of 6 questions at the pendulum stand',
    );
    await expect(question.locator('.record-part > .record-head')).toHaveText([
      /^What I tried/,
      /^What I concluded/,
      /^What I made/,
      /^Still to find out/,
    ]);
    const reading = question.locator('.reading-row').first();
    await expect(reading.locator('.reading-what')).toHaveText('release 2');
    await expect(reading.locator('.qty')).toHaveText([
      '2 degrees',
      /^\d+ g$/,
      '80 cm',
      /^17\.9\d s$/,
      /^\d+ swings$/,
    ]);
    const others = panel(page).getByRole('region', { name: 'Other questions' });
    await expect(others.locator('.question-fold')).toHaveCount(1);
    await expect(others.locator('.question-fold .note-card').first()).toBeHidden();

    // Right now ⇄ My notebook, by the link and back by the tab.
    await question.getByRole('button', { name: 'All of it in my notebook' }).click();
    await expect(tab(page, 'Notebook')).toHaveAttribute('aria-pressed', 'true');
    await expect(scroller(page)).toHaveJSProperty('scrollTop', 0);
    await expect(panel(page).locator('.notebook-thread')).toHaveCount(2);
    await tab(page, 'Activity').click();
    await expect(rightNow).toBeVisible();

    // With every fold open, on every page, no line runs past the panel's edge.
    for (const name of ['Activity', 'Notebook', 'Memories', 'About']) {
      await tab(page, name).click();
      const past = await scroller(page).evaluate((element) => {
        element.querySelectorAll('details').forEach((fold) => (fold.open = true));
        const edge = element.getBoundingClientRect().right;
        return {
          wider: element.scrollWidth - element.clientWidth,
          lines: [...element.querySelectorAll('*')]
            .filter(
              (node) =>
                !node.closest('.page-tabs') &&
                node.getBoundingClientRect().width > 0 &&
                node.getBoundingClientRect().right > edge + 1,
            )
            .map((node) => node.tagName + '.' + node.className)
            .slice(0, 5),
        };
      });
      expect(past, name).toEqual({ wider: 0, lines: [] });
      await page.screenshot({
        path: info.outputPath(name.toLowerCase().replace(/ /g, '-') + '-open.png'),
      });
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
  await tab(page, 'About').click();
  await panel(page).getByRole('button', { name: 'My wishes' }).click();
  await expect(title(page)).toHaveText('Wishes');
  await back(page, 'Hubert');
  await expect(tab(page, 'About')).toHaveAttribute('aria-pressed', 'true');

  // Hubert · Right now ⇄ Messages, Activity
  await tab(page, 'Activity').click();
  await panel(page).getByRole('button', { name: 'Message Hubert' }).click();
  await expect(title(page)).toHaveText('Messages');
  await page.screenshot({ path: info.outputPath('back-to-hubert.png') });
  await back(page, 'Hubert');
  await expect(tab(page, 'Activity')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('right-now.png') });
  await panel(page).getByRole('button', { name: 'See my whole day' }).click();
  await expect(title(page)).toHaveText('Days');
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
  await menu(page, 'Days');
  const day = panel(page).locator('.day-nav strong');
  await expect(day).toContainText('today');
  await panel(page)
    .getByRole('button', { name: /^My trail/ })
    .click();
  await page.screenshot({ path: info.outputPath('activity-trail.png') });
  // Steps are gathered under the question they were taken for, readings with their numbers.
  await expect(panel(page).locator('.story-question strong').first()).toContainText(
    'Why do the reeds lean',
  );
  await expect(panel(page).locator('.story-item .story-text .qty').first()).toBeVisible();
  await panel(page)
    .locator('.story-item')
    .getByRole('button', { name: place.name })
    .first()
    .click();
  await expect(title(page)).toHaveText(place.name);
  await back(page, 'Days');
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
  await back(page, 'Days');
  await panel(page)
    .getByRole('button', { name: /more memor/ })
    .click();
  await expect(tab(page, 'Memories')).toHaveAttribute('aria-pressed', 'true');
  await back(page, 'Days');
  await expect(title(page)).toHaveText('Days');

  // Settings closes back to the panel it was opened over; the menu starts a fresh visit
  await page.getByRole('button', { name: 'About Elsewhere', exact: true }).click();
  await expect(settings(page)).toBeVisible();
  await settings(page).getByRole('button', { name: 'Close settings' }).click();
  await expect(title(page)).toHaveText('Days');
  await menu(page, 'Wishes');
  await expect(panel(page).getByRole('button', { name: /^Back to/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
});

test('on a phone every page is in reach and Account links lead back to Account', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page);
  await openHubert(page);
  for (const name of ['About', 'Notebook', 'Activity', 'Memories']) {
    await tab(page, name).click({ timeout: 3_000 });
    await expect(tab(page, name)).toHaveAttribute('aria-pressed', 'true');
    await expect(tab(page, name)).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath('phone-pages.png') });
  await back(page, 'Residents');
  await expect(title(page)).toHaveText('Residents');

  await menu(page, 'Account');
  for (const name of ['Days', 'Wishes']) {
    await panel(page).getByRole('button', { name, exact: true }).click();
    await expect(title(page)).toHaveText(name);
    if (name === 'Days') await page.screenshot({ path: info.outputPath('phone-activity.png') });
    await back(page, 'Account');
    await expect(title(page)).toHaveText('Account');
  }
  await panel(page).getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(settings(page)).toBeVisible();
  await settings(page).getByRole('button', { name: 'Account', exact: true }).click();
  await expect(title(page)).toHaveText('Account');
});

test('resident navigation centers each label and memory pages share one reading edge', async ({
  page,
}) => {
  await mount(page);
  await openHubert(page);
  await panel(page).getByRole('button', { name: 'Memories', exact: true }).click();
  for (const width of [320, 390, 800, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await panel(page).evaluate((root) => {
      const tabs = [...root.querySelectorAll('.page-tabs button')];
      const boxes = tabs.map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect(),
          box = el.getBoundingClientRect();
        return { left: text.left - box.left, right: box.right - text.right, height: box.height };
      });
      const sort = root.querySelector('.sort-row')!.getBoundingClientRect();
      const heading = root.querySelector('.reading-heading')!.getBoundingClientRect();
      const article = root.querySelector<HTMLElement>('.memory-row p')!;
      return {
        boxes,
        edge: Math.abs(sort.x - heading.x),
        font: parseFloat(getComputedStyle(article).fontSize),
        outerOverflow: document.documentElement.scrollWidth - innerWidth,
        readingOverflow: article.scrollWidth - article.clientWidth,
      };
    });
    expect(metrics.edge).toBeLessThanOrEqual(1);
    expect(metrics.font).toBeGreaterThanOrEqual(16);
    expect(metrics.outerOverflow).toBeLessThanOrEqual(1);
    expect(metrics.readingOverflow).toBeLessThanOrEqual(1);
    for (const box of metrics.boxes) {
      expect(Math.abs(box.left - box.right)).toBeLessThanOrEqual(1);
      expect(box.left).toBeGreaterThanOrEqual(4);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  const disclosure = panel(page).locator('.memory-group-head h4 button').first();
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
});
