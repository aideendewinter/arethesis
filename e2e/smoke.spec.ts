import { test, expect } from './fixtures';

const pages = ['index.html', 'directory/index.html', 'kanban/index.html', 'editor/index.html', 'dashboard/index.html', 'signup/index.html', 'offline/index.html'];

for (const path of pages) {
  test(`${path} loads without errors`, async ({ page, errors }) => {
    await page.goto(`/${path}`);
    await expect(page.locator('.site-nav')).toBeVisible();
    await page.waitForTimeout(1500);
    void errors;
  });
}
