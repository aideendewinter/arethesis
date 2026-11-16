import { test, expect, clearStorage } from './fixtures';

test.beforeEach(async ({ page }) => clearStorage(page));

test('signs in, works offline from IndexedDB, and logout wipes the cache', async ({ page, errors }) => {
  await page.goto('/offline/index.html');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('me-card strong')).toHaveText('Alice Hopper');
  await expect(page.locator('.note')).toHaveCount(5);
  await expect(page.locator('#inspector tr')).not.toHaveCount(1);

  await page.locator('[data-mode=network]').click();
  await expect(page.locator('#log li').first()).toContainText('from the network');
  await page.locator('[data-mode=cache-first]').click();
  await expect(page.locator('#log li').first()).toContainText('served from the store');

  // Offline + reload: data comes back from IndexedDB.
  await page.waitForTimeout(300);
  await page.locator('#offline').check();
  await page.reload();
  await expect(page.locator('.note')).toHaveCount(5);
  await expect(page.locator('#inspector')).toContainText('indexeddb');
  await page.locator('#offline').uncheck();

  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.locator('#inspector')).toContainText('The store is empty');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('#inspector')).toContainText('The store is empty');
  void errors;
});

test('a saved session the server no longer accepts brings the sign-in form back', async ({ page, errors }) => {
  await page.goto('/offline/index.html');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('me-card strong')).toHaveText('Alice Hopper');

  // A reload keeps you signed in: the saved refresh token renews the session.
  await page.reload();
  await expect(page.locator('me-card strong')).toHaveText('Alice Hopper');

  // Now the server stops recognising the session (revoked, or signed out elsewhere).
  await page.evaluate(() => localStorage.setItem('refresh_token', 'refresh.someone-else.20.x'));
  await page.getByRole('button', { name: 'Expire token now' }).click();

  // The refresh is refused, the session ends, and the page offers sign-in again.
  await expect(page.locator('.toast').filter({ hasText: 'Your session expired' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('#signed-in')).toBeHidden();
  await expect(page.locator('#notes')).toContainText('Sign in to load notes');
  await expect(page.locator('#password')).toBeFocused();

  // After a reload too: no tokens are left, so the form is shown.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  // And signing in works again.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('me-card strong')).toHaveText('Alice Hopper');
  await expect(page.locator('.note')).toHaveCount(5);
  void errors;
});
