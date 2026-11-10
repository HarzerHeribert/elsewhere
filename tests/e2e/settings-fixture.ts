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
  if (!(await region.isVisible()))
    await page
      .getByRole('navigation', { name: 'World navigation' })
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
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
