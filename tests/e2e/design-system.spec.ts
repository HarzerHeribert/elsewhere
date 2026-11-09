import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('brand gallery video controls work under the production content security policy', async ({
  page,
}) => {
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const policy = vercel.routes.find(
    (route: { headers?: Record<string, string> }) => route.headers?.['Content-Security-Policy'],
  ).headers['Content-Security-Policy'];
  await page.route('**/brand/index.html', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': policy },
    });
  });
  await page.goto('/brand/index.html');
  const video = page.locator('#ident');
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.getByRole('button', { name: 'Play ident ↗', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replay ident ↗', exact: true })).toBeVisible();
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
});

test('design system uses working forms, button states and the shared focus-managed modal', async ({
  page,
}) => {
  await page.goto('/design-system.html');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Digital lives.');
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByLabel('A field note')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('status')).toHaveText('Write a note before saving.');
  await page.getByLabel('A field note').fill('The leaf remains unconvinced.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Saved in this example. Nothing was sent.');
  await page.getByRole('button', { name: 'Places', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The meadow', exact: true })).toBeVisible();
  const opener = page.getByRole('button', { name: 'Open a panel' });
  await opener.click();
  const modal = page.getByRole('dialog', { name: 'Meet a resident.' });
  await expect(modal).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(modal.getByRole('button', { name: 'Back to the field guide' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('icon motion converges after interruption and settles immediately with reduced motion', async ({
  page,
}) => {
  await page.goto('/design-system.html');
  const toggle = page.getByRole('button', { name: 'Toggle arrow and check' });
  const lines = toggle.locator('line');
  await toggle.click();
  await toggle.click();
  await toggle.click();
  await expect(lines.nth(0)).toHaveAttribute('x2', '10');
  await expect(lines.nth(1)).toHaveAttribute('y2', '6');
  await expect(lines.nth(2)).toHaveAttribute('opacity', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  await expect(lines.nth(0)).toHaveAttribute('x2', '20');
  await expect(lines.nth(0)).toHaveAttribute('y2', '12');
  await expect(page.locator('html')).toHaveCSS('--ew-duration-panel', '0ms');
});

test('design system and outlined wordmark fit a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/design-system.html');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const image of await page.locator('img').all()) {
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Open a panel' }).click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
