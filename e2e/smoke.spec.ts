import { test, expect } from './fixtures';

const pages = ['index.html', 'directory/index.html', 'kanban/index.html', 'editor/index.html', 'dashboard/index.html', 'treasury/index.html', 'agora/index.html', 'reader/index.html', 'signup/index.html', 'offline/index.html'];

for (const path of pages) {
  test(`${path} loads without errors`, async ({ page, errors }) => {
    await page.goto(`/${path}`);
    await expect(page.locator('.site-nav')).toBeVisible();
    await page.waitForTimeout(1500);
    void errors;
  });
}

test('the command palette navigates, runs actions and searches the page', async ({ page, errors }) => {
  await page.goto('/directory/index.html');
  await expect(page.locator('a-data-table tbody tr[data-id]').first()).toBeVisible();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  const input = palette.getByRole('combobox', { name: 'Search commands' });
  await expect(input).toBeFocused();

  // Find someone loaded in the table, by a few letters of their name.
  const name = (await page.locator('a-data-table tbody td[data-col=name]').first().textContent())!;
  await input.fill(name.slice(0, 5));
  await expect(palette.getByRole('option').first()).toContainText(name.slice(0, 5));
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.locator('person-card h2')).not.toBeEmpty();

  // An action: switch theme.
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  await page.getByRole('button', { name: /Ask the Oracle/ }).click();
  await input.fill('theme');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);

  // Navigate to another page.
  await page.keyboard.press('Control+k');
  await input.fill('treas');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/treasury/);
  void errors;
});
