import { test, expect, clearStorage } from './fixtures';

test.beforeEach(async ({ page }) => clearStorage(page));

test('moves a card with the keyboard and syncs to another tab', async ({ page, context, errors }) => {
  await page.goto('/kanban/index.html');
  const backlog = page.locator('ul[data-status=backlog]');
  const doing = page.locator('ul[data-status=doing]');
  await expect(backlog.locator('li')).toHaveCount(4);
  const card = backlog.locator('li').first();
  const title = (await card.locator('.kcard__title').textContent())!;

  const other = await context.newPage();
  await other.goto('/kanban/index.html');
  await expect(other.locator('ul[data-status=backlog] li')).toHaveCount(4);

  await card.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(doing.locator('.kcard__title', { hasText: title })).toBeVisible();
  await expect(page.locator('[data-count=doing]')).toHaveText('4');

  // The other tab receives the move over SSE.
  await expect(other.locator('ul[data-status=doing] .kcard__title', { hasText: title })).toBeVisible();
  void errors;
});

test('adds and deletes cards', async ({ page, errors }) => {
  await page.goto('/kanban/index.html');
  await page.locator('[data-add=review]').click();
  await page.keyboard.type('Write the e2e tests');
  await page.keyboard.press('Enter');
  const card = page.locator('ul[data-status=review] li', { hasText: 'Write the e2e tests' });
  // Wait until the server has confirmed the card (temporary id swapped for a real one).
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-id', /^t\d+$/);
  await expect(card).not.toHaveAttribute('data-pending');
  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
  void errors;
});

test('drags a card between columns with the mouse', async ({ page, context, errors }) => {
  await page.goto('/kanban/index.html');
  const backlog = page.locator('ul[data-status=backlog]');
  const doing = page.locator('ul[data-status=doing]');
  await expect(backlog.locator('li')).toHaveCount(4);
  const card = backlog.locator('li').first();
  const title = (await card.locator('.kcard__title').textContent())!;
  const from = (await card.boundingBox())!;
  const target = (await doing.locator('li').nth(1).boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
  // Mid-drag: the card is lifted but still in its own list, and a placeholder is in the target.
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.25, { steps: 12 });
  await expect(page.locator('ul[data-status=doing] > .sortable-placeholder')).toHaveCount(1);
  expect(await card.evaluate(el => el.parentElement?.getAttribute('data-status'))).toBe('backlog');
  await page.mouse.up();

  // Dropped before the second card of "In progress", and saved.
  await expect(doing.locator('li').nth(1).locator('.kcard__title')).toHaveText(title);
  await expect(page.locator('[data-count=doing]')).toHaveText('4');
  await expect(page.locator('.sortable-placeholder')).toHaveCount(0);
  // The server has the new position: a second tab shows the card in the same place.
  const other = await context.newPage();
  await other.goto('/kanban/index.html');
  await expect(other.locator('ul[data-status=doing] li').nth(1).locator('.kcard__title')).toHaveText(title);
  void errors;
});
