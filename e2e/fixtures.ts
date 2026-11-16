import { test as base, expect, type Page } from '@playwright/test';

/** Fails the test if the page logs an error or throws. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    await use(errors);
    expect(errors, 'no console errors').toEqual([]);
  },
});

export { expect };

/** Fresh storage for each test so IndexedDB caches don't leak between runs. */
export async function clearStorage(page: Page): Promise<void> {
  await page.goto('/index.html');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const dbs = await indexedDB.databases?.() ?? [];
    await Promise.all(dbs.map(db => new Promise(r => {
      const req = indexedDB.deleteDatabase(db.name!);
      req.onsuccess = req.onerror = req.onblocked = () => r(null);
    })));
  });
}
