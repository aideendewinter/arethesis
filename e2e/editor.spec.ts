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
  // Both editors have loaded the document (they're read-only until then).
  await expect(a).not.toHaveAttribute('aria-busy');
  await expect(b).not.toHaveAttribute('aria-busy');

  // Type at the start in one window and at the end in the other, at the same time.
  await a.focus();
  await page.keyboard.press('Control+Home');
  await b.focus();
  await other.keyboard.press('Control+End');
  await Promise.all([page.keyboard.type('AAAA ', { delay: 20 }), other.keyboard.type(' BBBB', { delay: 20 })]);

  // Wait for both sessions to be fully synced (the badge itself lags on purpose,
  // so it doesn't flash "Saving…"), then both windows must hold the same text.
  await expect(page.locator('#sync')).toHaveText('synced', { timeout: 10_000 });
  await expect(other.locator('#sync')).toHaveText('synced', { timeout: 10_000 });
  await expect.poll(async () => (await a.inputValue()) === (await b.inputValue()), { timeout: 10_000 }).toBe(true);
  const valueA = await a.inputValue();
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

test('typing does not resize the status badge or shift the toolbar', async ({ page, errors }) => {
  await page.goto('/editor/index.html');
  const badge = page.locator('#collab-status');
  await expect(badge).toHaveAttribute('data-status', 'synced');

  // Record the badge's width and its neighbour's position on every frame while typing.
  await page.evaluate(() => {
    const samples: string[] = [];
    (window as unknown as { samples: string[] }).samples = samples;
    const badge = document.querySelector('#collab-status')!;
    const next = badge.nextElementSibling!;
    const tick = () => {
      samples.push(`${badge.getBoundingClientRect().width.toFixed(1)}|${next.getBoundingClientRect().left.toFixed(1)}`);
      requestAnimationFrame(tick);
    };
    tick();
  });
  await page.locator('#doc').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' The quick brown fox jumps over the lazy dog.', { delay: 30 });
  await page.waitForTimeout(1200);
  const samples = await page.evaluate(() => (window as unknown as { samples: string[] }).samples);
  expect(samples.length).toBeGreaterThan(20);
  expect(new Set(samples).size, 'badge width and toolbar position never change').toBe(1);

  // Only the current label is visible (and read out).
  await expect(badge).toHaveAttribute('data-status', 'synced');
  await expect(badge.getByText('All changes saved')).toBeVisible();
  await expect(badge.getByText('Saving…')).toBeHidden();
  expect(await badge.evaluate(el => (el as HTMLElement).innerText.trim())).toBe('All changes saved');
  void errors;
});

test('on a slow network the badge shows edits being saved', async ({ page, errors }) => {
  await page.goto('/editor/index.html');
  const badge = page.locator('#collab-status');
  await expect(badge).toHaveAttribute('data-status', 'synced');
  await page.getByLabel('Network').selectOption({ label: 'Slow (1 s)' });

  await page.locator('#doc').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Slow and steady.', { delay: 40 });
  await expect(badge).toHaveAttribute('data-status', 'syncing');
  await expect(badge.getByText('Saving…')).toBeVisible();
  await expect(badge).toHaveAttribute('data-status', 'synced', { timeout: 8000 });
  await expect(badge.getByText('All changes saved')).toBeVisible();

  // The choice is remembered across reloads (and pages).
  await page.reload();
  await expect(page.getByLabel('Network')).toHaveValue('1000');
  await expect(page.locator('#collab-status')).toHaveAttribute('data-status', 'synced', { timeout: 8000 });

  // On an instant network, quick saves don't flash "Saving…".
  await page.getByLabel('Network').selectOption({ label: 'Instant' });
  const seen = await page.evaluate(() => {
    const statuses = new Set<string>();
    new MutationObserver(() => statuses.add(document.querySelector<HTMLElement>('#collab-status')!.dataset.status!)).observe(document.querySelector('#collab-status')!, { attributes: true });
    (window as unknown as { statuses: Set<string> }).statuses = statuses;
    return true;
  });
  expect(seen).toBe(true);
  await page.locator('#doc').click();
  await page.keyboard.type(' Quick.', { delay: 40 });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => [...(window as unknown as { statuses: Set<string> }).statuses])).not.toContain('syncing');
  void errors;
});
