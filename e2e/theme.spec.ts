import { test, expect } from './fixtures';

// The examples wear the Polychrome theme: limestone (245, 238, 223) by day, black glaze (20, 16, 12) by night.
const pages = ['index.html', 'directory/index.html', 'kanban/index.html', 'editor/index.html', 'dashboard/index.html', 'treasury/index.html', 'agora/index.html', 'signup/index.html', 'offline/index.html'];
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
    expect(await background(page), path).toBe('rgb(20, 16, 12)');
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
  expect(await background(page)).toBe('rgb(245, 238, 223)');

  // No saved choice: follow the system.
  await page.evaluate(() => localStorage.removeItem('ar-theme'));
  await page.goto('/kanban/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body !== null);
  expect(await background(page)).toBe('rgb(20, 16, 12)');
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

test('high contrast follows the OS, can be toggled, and is remembered without a flash', async ({ page, errors }) => {
  const text = () => page.evaluate(() => getComputedStyle(document.body).color);
  const toggle = page.getByRole('button', { name: 'High contrast' });

  // The OS asks for more contrast: the high-contrast palette applies, and the toggle says so.
  await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
  await page.goto('/kanban/index.html');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await text()).toBe('rgb(0, 0, 0)');

  // Turn it off: standard colors, remembered across pages.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await text()).toBe('rgb(29, 23, 18)');
  await page.goto('/directory/index.html');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // Turn it on with a standard OS setting, in dark mode, and check the first paint.
  await page.emulateMedia({ colorScheme: 'dark', contrast: 'no-preference' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await text()).toBe('rgb(255, 255, 255)');
  await page.route(/\.(js|ts)(\?|$)/, () => {});
  await page.goto('/offline/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body !== null);
  expect(await page.evaluate(() => document.documentElement.dataset.contrast)).toBe('more');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(0, 0, 0)');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  void errors;
});

test('every page fits a phone screen, with the header links on their own row', async ({ page, errors }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of pages) {
    await page.goto(`/${path}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} scrolls sideways`).toBeLessThanOrEqual(390);
    for (const name of ['Arethesis on GitHub', 'High contrast']) await expect(page.getByRole(name === 'High contrast' ? 'button' : 'link', { name })).toBeInViewport();
    await expect(page.locator('[data-theme-toggle]')).toBeInViewport();
  }
  void errors;
});

test('the header and footer link to GitHub and npm', async ({ page, errors }) => {
  await page.goto('/kanban/index.html');
  await expect(page.getByRole('link', { name: 'Arethesis on GitHub' })).toHaveAttribute('href', 'https://github.com/aideendewinter/arethesis');
  const footer = page.locator('footer.site-footer');
  await expect(footer.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/aideendewinter/arethesis');
  await expect(footer.getByRole('link', { name: 'npm' })).toHaveAttribute('href', 'https://www.npmjs.com/package/arethesis');
  await expect(footer).toContainText(/Arethesis \d+\.\d+\.\d+/);
  void errors;
});
