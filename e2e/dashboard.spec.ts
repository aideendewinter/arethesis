import { test, expect, clearStorage } from './fixtures';

test.beforeEach(async ({ page }) => clearStorage(page));

test('streams metrics and remembers the layout', async ({ page, errors }) => {
  await page.goto('/dashboard/index.html');
  const value = page.locator('.ar-flex__panel[data-key=revenue] .stat__value');
  await expect(value).toHaveText(/\$/);
  const first = await value.textContent();
  await expect(value).not.toHaveText(first!, { timeout: 10_000 });

  await expect(page.locator('.feed__item').first()).toBeVisible();

  // Move the "Revenue" panel one place to the right with the keyboard.
  const panels = page.locator('.ar-flex__panel');
  await expect(panels.first()).toHaveAttribute('data-key', 'revenue');
  await panels.first().focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(panels.nth(1)).toHaveAttribute('data-key', 'revenue');

  // The layout is persisted to IndexedDB and restored after a reload.
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.ar-flex__panel').nth(1)).toHaveAttribute('data-key', 'revenue');
  await page.locator('#reset').click();
  await expect(page.locator('.ar-flex__panel').first()).toHaveAttribute('data-key', 'revenue');
  void errors;
});

test('the gap between two panels is a splitter that shares space between them', async ({ page, errors }) => {
  await page.goto('/dashboard/index.html');
  const activity = page.locator('.ar-flex__panel[data-key=activity]');
  const about = page.locator('.ar-flex__panel[data-key=about]');
  await expect(activity.locator('.feed__item').first()).toBeVisible();
  const box = async (l: typeof activity) => (await l.boundingBox())!;
  const a0 = await box(activity);
  const b0 = await box(about);

  // Row ends have no splitter on their right; "How this works" ends its row, so it
  // is resized from its left edge, which is the splitter after "Activity".
  await expect(page.locator('[data-key=conversion] > .ar-flex__splitter')).toBeHidden();
  await expect(about.locator(':scope > .ar-flex__splitter')).toBeHidden();
  const splitter = activity.locator(':scope > .ar-flex__splitter');
  await expect(splitter).toBeVisible();
  await expect(splitter).toHaveAttribute('aria-label', 'Resize Activity and How this works');

  // Drag the splitter 150px left: Activity shrinks, its neighbour grows by the same amount.
  await splitter.scrollIntoViewIfNeeded();
  const s = await box(splitter as never);
  const x = s.x + s.width / 2;
  const y = s.y + s.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 75, y, { steps: 5 });
  await page.mouse.move(x - 150, y, { steps: 5 });
  await page.mouse.up();
  const a1 = await box(activity);
  const b1 = await box(about);
  expect(Math.round(a1.width)).toBe(Math.round(a0.width - 150));
  expect(Math.round(b1.width)).toBe(Math.round(b0.width + 150));
  expect(Math.round(b1.x + b1.width)).toBe(Math.round(b0.x + b0.width)); // the row stays full
  expect(Math.round(b1.y)).toBe(Math.round(a1.y)); // nothing wrapped

  // Keyboard: focus the splitter and press End to give Activity as much room as possible.
  await splitter.focus();
  await page.keyboard.press('End');
  await expect.poll(async () => Math.round((await box(about)).width)).toBeLessThan(Math.round(b0.width));

  // The bottom edge changes the height.
  await page.keyboard.press('Home');
  await activity.locator('.resize-handle--s').scrollIntoViewIfNeeded();
  const tall = (await box(activity)).height;
  const south = (await activity.locator('.resize-handle--s').boundingBox())!;
  await page.mouse.move(south.x + 40, south.y + south.height / 2);
  await page.mouse.down();
  await page.mouse.move(south.x + 40, south.y + south.height / 2 + 80, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await box(activity)).height)).toBe(Math.round(tall + 80));
  const resized = await box(activity);

  // Sizes survive a reload, and "Reset layout" restores the defaults.
  await page.waitForTimeout(300);
  await page.reload();
  await expect.poll(async () => Math.round((await box(activity)).width)).toBe(Math.round(resized.width));
  await page.locator('#reset').click();
  await expect.poll(async () => Math.round((await box(activity)).width)).toBe(Math.round(a0.width));
  void errors;
});

test('on a narrow screen panels stack and the splitters go away', async ({ page, errors }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/dashboard/index.html');
  await expect(page.locator('.ar-flex__panel')).toHaveCount(6);
  await expect(page.locator('.ar-flex__splitter:visible')).toHaveCount(0);
  // Widen it again: the splitters come back.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.ar-flex__splitter:visible')).not.toHaveCount(0);
  void errors;
});

test('relative times in the feed keep up with the clock', async ({ page, errors }) => {
  await page.clock.install();
  await page.goto('/dashboard/index.html');
  const item = page.locator('.feed__item').filter({ has: page.locator('time', { hasText: /^7 minutes ago$/ }) }).first();
  await expect(item).toBeVisible();
  const who = await item.locator('strong').textContent();
  const what = await item.locator('[data-bind=message]').textContent();
  const sameItem = page.locator('.feed__item').filter({ hasText: `${who} ${what}` }).filter({ has: page.locator('time') }).first();
  await expect(sameItem.locator('time')).toHaveAttribute('title', /\d/); // the exact time on hover

  await page.clock.fastForward('10:00');
  await expect(sameItem.locator('time')).toHaveText('17 minutes ago');
  await page.clock.fastForward('01:00:00');
  await expect(sameItem.locator('time')).toHaveText('1 hour ago');
  void errors;
});
