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

test('panels reorder by dragging their title, across rows, without re-rendering', async ({ page, errors }) => {
  await page.goto('/dashboard/index.html');
  const panels = page.locator('.ar-flex__panel');
  await expect(page.locator('.feed__item strong').first()).toBeVisible();
  // Tag the live feed component, to check it's the same element (not re-created) afterwards.
  await page.locator('activity-feed').evaluate(el => ((el as HTMLElement & { tagged?: boolean }).tagged = true));
  const feedItems = await page.locator('.feed__item').count();

  // Drag "How this works" (second row) by its title to the start of the first row.
  const handle = page.locator('[data-key=about] .ar-flex__header');
  await handle.scrollIntoViewIfNeeded();
  const h = (await handle.boundingBox())!;
  const first = (await panels.first().boundingBox())!;
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 40, h.y + h.height / 2 - 10, { steps: 3 });
  await page.mouse.move(first.x + 10, first.y + first.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect(panels.first()).toHaveAttribute('data-key', 'about');
  expect(await page.locator('activity-feed').evaluate(el => (el as HTMLElement & { tagged?: boolean }).tagged)).toBe(true);
  expect(await page.locator('.feed__item').count()).toBeGreaterThanOrEqual(feedItems);
  await expect(page.locator('.sortable-placeholder')).toHaveCount(0);

  // The new order is remembered.
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.ar-flex__panel').first()).toHaveAttribute('data-key', 'about');
  void errors;
});

test('splitters follow a panel that is dragged into another row', async ({ page, errors }) => {
  await page.setViewportSize({ width: 1280, height: 1200 }); // the whole dashboard fits, so nothing auto-scrolls
  await page.goto('/dashboard/index.html');
  await expect(page.locator('.feed__item strong').first()).toBeVisible();
  // Record the splitters right after the drop, before anything else (like the
  // dashboard changing height) could refresh them.
  await page.evaluate(() => {
    document.querySelector('.ar-flex')!.addEventListener('sortable:end', () => setTimeout(() => {
      (window as unknown as { atDrop: Record<string, boolean> }).atDrop = Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.ar-flex__panel')].map(p => [p.dataset.key!, !(p.querySelector<HTMLElement>(':scope > .ar-flex__splitter')?.hidden ?? true)]),
      );
    }));
  });
  // Drag "How this works" between "Revenue" and "Users".
  const handle = page.locator('[data-key=about] .ar-flex__header');
  const h = (await handle.boundingBox())!;
  const revenue = (await page.locator('[data-key=revenue]').boundingBox())!;
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 40, h.y + h.height / 2 - 10, { steps: 3 });
  await page.mouse.move(revenue.x + revenue.width * 0.8, revenue.y + revenue.height / 2, { steps: 15 });
  await page.mouse.up();
  const keys = () => page.locator('.ar-flex__panel').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.key));
  await expect.poll(keys).toEqual(['revenue', 'about', 'users', 'orders', 'conversion', 'activity']);

  // Its neighbours in the same row have splitters on both sides of it.
  const rowOf = (key: string) => page.locator(`[data-key=${key}]`).evaluate(el => Math.round(el.getBoundingClientRect().top));
  expect(await rowOf('about')).toBe(await rowOf('revenue'));
  await expect(page.locator('[data-key=revenue] > .ar-flex__splitter')).toBeVisible();
  await expect(page.locator('[data-key=about] > .ar-flex__splitter')).toBeVisible();
  const atDrop = () => page.evaluate(() => (window as unknown as { atDrop: Record<string, boolean> }).atDrop);
  expect(await atDrop()).toMatchObject({ revenue: true, about: true });

  // Within one row, so the dashboard's height doesn't change and nothing else refreshes the splitters:
  // drag "Activity" in front of "Conversion".
  const a = (await page.locator('[data-key=activity] .ar-flex__header').boundingBox())!;
  const conversion = (await page.locator('[data-key=conversion]').boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 - 10, { steps: 3 });
  await page.mouse.move(conversion.x + conversion.width * 0.2, conversion.y + conversion.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect.poll(keys).toEqual(['revenue', 'about', 'users', 'orders', 'activity', 'conversion']);
  expect(await rowOf('activity')).toBe(await rowOf('conversion'));
  expect(await atDrop()).toMatchObject({ activity: true, conversion: false });
  void errors;
});
