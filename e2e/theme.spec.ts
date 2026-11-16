import { test, expect } from './fixtures';

const pages = ['index.html', 'directory/index.html', 'kanban/index.html', 'editor/index.html', 'dashboard/index.html', 'signup/index.html', 'offline/index.html'];
const background = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test('pages paint in the saved theme before any script runs (no white flash)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('ar-theme', 'dark'));

  // Hold back every script, so what we see is the first paint.
  const held: Array<() => Promise<void>> = [];
  await page.route(/\.(js|ts)(\?|$)/, route => { held.push(() => route.continue()); });
  for (const path of pages) {
    await page.goto(`/${path}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => document.body !== null);
    expect(await background(page), path).toBe('rgb(15, 17, 23)');
    expect(await page.evaluate(() => document.documentElement.dataset.theme), path).toBe('dark');
    // The half-built page stays hidden until its chrome is ready.
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility), path).toBe('hidden');
  }
  // If the scripts never run, the page is revealed anyway.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).visibility), { timeout: 4000 }).toBe('visible');

  // The other way round: a light choice on a dark system.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => localStorage.setItem('ar-theme', 'light'));
  await page.goto('/kanban/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body !== null);
  expect(await background(page)).toBe('rgb(255, 255, 255)');

  // No saved choice: follow the system.
  await page.evaluate(() => localStorage.removeItem('ar-theme'));
  await page.goto('/kanban/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body !== null);
  expect(await background(page)).toBe('rgb(15, 17, 23)');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  void held;
});

test('each page is revealed in one go once its chrome is ready', async ({ page, errors }) => {
  for (const path of pages) {
    await page.goto(`/${path}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '');
    await expect(page.getByRole('navigation', { name: 'Examples' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).visibility), path).toBe('visible');
  }
  void errors;
});
