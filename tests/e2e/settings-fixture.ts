import { expect, type Page } from '@playwright/test';

export type SettingsSectionName =
  | 'Account'
  | 'Sign-in & security'
  | 'Mail'
  | 'Creations'
  | 'Controls'
  | 'World'
  | 'About Elsewhere';

/** Settings take the place of the world; a signed-in visitor's account lives here. */
export function settings(page: Page) {
  return page.getByRole('region', { name: 'Settings', exact: true });
}
/** Opens Settings if needed, selects one section and returns the Settings region. */
export async function openSettings(page: Page, section: SettingsSectionName = 'Account') {
  const region = settings(page);
  if (!(await region.isVisible())) {
    await page
      .getByRole('navigation', { name: 'World navigation' })
      .getByRole('button', { name: 'Account', exact: true })
      .click();
    await page
      .getByLabel('World panel', { exact: true })
      .getByRole('button', { name: 'Controls', exact: true })
      .click();
  }
  await region
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: section === 'World' ? /^World/ : section, exact: true })
    .click();
  await expect(
    region.getByRole('heading', {
      level: 2,
      name: section === 'World' ? 'World settings' : section,
      exact: true,
    }),
  ).toBeVisible();
  return region;
}
/** Where the account shows: the sign-in dialog for a guest, Settings once signed in. */
export function accountSurface(page: Page) {
  return page.getByRole('dialog').or(settings(page));
}
export async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(settings(page)).not.toBeVisible();
}

/** Follow the same public destinations on desktop and phone. */
export async function visitPage(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: 'World navigation' });
  const panel = page.getByLabel('World panel', { exact: true });
  if (name === 'Map') {
    await nav.getByRole('button', { name: 'World', exact: true }).click();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
  } else if (name === 'Messages') {
    await nav.getByRole('button', { name: 'Residents', exact: true }).click();
    await panel.getByRole('button', { name: 'Select Hubert' }).click();
    await panel.getByRole('button', { name: 'Write to Hubert' }).click();
  } else if (name === 'Wishes') {
    await nav.getByRole('button', { name: 'Account', exact: true }).click();
    await panel.getByRole('button', { name: /^Wishes/ }).click();
  } else {
    await nav.getByRole('button', { name, exact: true }).click();
  }
}
