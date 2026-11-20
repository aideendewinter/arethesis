import { test, expect } from './fixtures';

test('threads load, scroll for more, sort, and move with Page Down', async ({ page, errors }) => {
  await page.goto('/agora/index.html');
  await page.locator('#talk').uncheck(); // a quiet agora, so nothing moves under us
  const feed = page.getByRole('feed', { name: 'Discussion' });
  const top = feed.locator(':scope > .agora-item > article');
  await expect(top).toHaveCount(4);
  await expect(top.first()).toContainText('what virtue is');
  // Replies are loaded for each thread.
  await expect(top.first().locator('.thread article').first()).toContainText('A man’s virtue');

  // Infinite scroll brings older threads.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(top).toHaveCount(6);
  await expect(top.first()).toHaveAttribute('aria-posinset', '1');

  // Feed keys.
  await top.first().focus();
  await page.keyboard.press('PageDown');
  await expect(top.nth(1)).toBeFocused();

  // Newest first comes from the server.
  await page.getByRole('button', { name: 'Newest' }).click();
  await expect(top.first()).toContainText('Hipparchia');
  void errors;
});

test('votes are optimistic and roll back when the server refuses', async ({ page, errors }) => {
  await page.goto('/agora/index.html');
  // A quiet agora (remembered for the session), so no one else votes or replies while we do.
  await page.locator('#talk').uncheck();
  await page.reload();
  await expect(page.locator('#talk')).not.toBeChecked();
  const first = page.getByRole('feed').locator(':scope > .agora-item > article').first();
  const score = first.locator(':scope > footer .vote__score');
  await expect(score).toHaveText('42');
  await first.getByRole('button', { name: 'Agree with Socrates', exact: true }).first().click();
  await expect(score).toHaveText('43');
  await expect(first.getByRole('button', { name: 'Agree with Socrates', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');

  // Let that vote reach the server (the simulated network is slow) before it starts refusing.
  await page.waitForTimeout(1200);
  // When the server refuses, the vote shows at once and is then undone.
  await page.locator('#failures').check();
  await first.getByRole('button', { name: 'Disagree with Socrates', exact: true }).first().click();
  await expect(page.locator('.toast[data-kind=error]').first()).toContainText('rolled back');
  await expect(score).toHaveText('43');
  await expect(first.getByRole('button', { name: 'Agree with Socrates', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  void errors;
});

test('replies post, appear in another window, and arrive live', async ({ context, page, errors }) => {
  const other = await context.newPage();
  await page.goto('/agora/index.html');
  await other.goto('/agora/index.html');
  await page.locator('#talk').uncheck();
  const thread = (p: typeof page) => p.getByRole('feed').locator(':scope > .agora-item > article').first();
  await expect(thread(other).locator('.thread article').first()).toBeVisible();

  await thread(page).locator(':scope > footer').getByRole('button', { name: 'Reply' }).click();
  await page.getByLabel('Reply to Socrates').fill('Perhaps virtue is the knowledge of what is truly good.');
  await page.locator('.reply-form button[type=submit]').click();
  await expect(thread(page)).toContainText('knowledge of what is truly good');
  await expect(thread(other)).toContainText('knowledge of what is truly good', { timeout: 10_000 });

  // Posts are sanitized on the way in and out.
  await thread(page).locator(':scope > footer').getByRole('button', { name: 'Reply' }).click();
  await page.getByLabel('Reply to Socrates').fill('<img src=x onerror="window.pwned=1"> hello');
  await page.locator('.reply-form button[type=submit]').click();
  await expect(thread(page)).toContainText('<img src=x');
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  void errors;
});
