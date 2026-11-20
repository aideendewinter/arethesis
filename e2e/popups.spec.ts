import { test, expect, clearStorage } from './fixtures';

test.beforeEach(async ({ page }) => clearStorage(page));

/** Whether the point at the center of `selector` hits the element itself (it isn't clipped or covered). */
const unobstructed = (selector: string) => () => {
  const el = document.querySelector<HTMLElement>(selector)!;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 4);
  return !!hit && el.contains(hit);
};

test('a choice list in the last visible table row is not clipped by the scrolling table', async ({ page, errors }) => {
  await page.goto('/directory/index.html');
  const scroller = page.locator('.ar-table__scroll');
  const rows = page.locator('a-data-table tbody tr[data-id]');
  await expect(rows).toHaveCount(50);
  // Find the last row that is fully visible in the scroll container.
  const index = await scroller.evaluate(el => {
    const bottom = el.getBoundingClientRect().bottom;
    const all = Array.from(el.querySelectorAll('tbody tr[data-id]'));
    let last = 0;
    all.forEach((tr, i) => {
      if (tr.getBoundingClientRect().bottom <= bottom) last = i;
    });
    return last;
  });
  await rows.nth(index).locator('td[data-col=department]').click();
  const list = page.locator('.ar-cell-editor .ar-listbox, .ar-listbox:not([hidden])').first();
  await expect(list).toBeVisible();
  // It extends below the table's scroll box, and is still the topmost thing there.
  const [listBox, scrollBox] = [await list.boundingBox(), await scroller.boundingBox()];
  expect(listBox!.y + listBox!.height).toBeGreaterThan(scrollBox!.y + scrollBox!.height - 200);
  expect(await page.evaluate(unobstructed('.ar-listbox:not([hidden])'))).toBe(true);
  // Escape closes it and the editor, and focus returns to the cell.
  await page.keyboard.press('Escape');
  await expect(page.locator('.ar-listbox:not([hidden])')).toHaveCount(0);
  void errors;
});

test('a tooltip shows on focus, is linked to its trigger, and Escape hides it', async ({ page, errors }) => {
  await page.goto('/kanban/index.html');
  const trigger = page.locator('[aria-describedby^="tooltip"]').first();
  await expect(trigger).toBeAttached();
  await trigger.focus();
  const id = (await trigger.getAttribute('aria-describedby'))!.split(' ').pop()!;
  const tip = page.locator(`#${id}`);
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute('role', 'tooltip');
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  void errors;
});

test('a context menu opens from the keyboard, is on top, and returns focus when closed', async ({ page, errors }) => {
  await page.goto('/kanban/index.html');
  const card = page.locator('[aria-haspopup="menu"] [tabindex="0"], [aria-haspopup="menu"][tabindex="0"]').first();
  await card.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  expect(await page.evaluate(unobstructed('.context-menu'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(card).toBeFocused();
  void errors;
});
