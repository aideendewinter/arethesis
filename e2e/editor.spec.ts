import { test, expect } from './fixtures';

test('two windows edit concurrently and converge', async ({ context, page, errors }) => {
  const other = await context.newPage();
  await page.goto('/editor/index.html');
  await other.goto('/editor/index.html');
  const a = page.locator('#doc');
  const b = other.locator('#doc');
  await expect(a).toHaveValue(/Launch plan/);
  await expect(b).toHaveValue(/Launch plan/);
  await expect(page.locator('.people li')).toHaveCount(2);

  // Type at the start in one window and at the end in the other, at the same time.
  await a.focus();
  await page.keyboard.press('Control+Home');
  await b.focus();
  await other.keyboard.press('Control+End');
  await Promise.all([page.keyboard.type('AAAA ', { delay: 20 }), other.keyboard.type(' BBBB', { delay: 20 })]);

  await expect(page.locator('#collab-status')).toHaveAttribute('data-status', 'synced');
  await expect(other.locator('#collab-status')).toHaveAttribute('data-status', 'synced');
  const valueA = await a.inputValue();
  await expect(b).toHaveValue(valueA);
  expect(valueA.startsWith('AAAA ')).toBe(true);
  expect(valueA.trimEnd().endsWith('BBBB')).toBe(true);
  void errors;
});

test('keeps offline edits and syncs them on reconnect', async ({ page, errors }) => {
  await page.goto('/editor/index.html');
  const doc = page.locator('#doc');
  await expect(doc).toHaveValue(/Launch plan/);
  await page.locator('#offline').check();
  await expect(page.locator('#collab-status')).toHaveAttribute('data-status', 'offline');
  await doc.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nWritten offline.');
  await page.locator('#offline').uncheck();
  await expect(page.locator('#collab-status')).toHaveAttribute('data-status', 'synced', { timeout: 15_000 });
  await expect(doc).toHaveValue(/Written offline\./);
  void errors;
});
