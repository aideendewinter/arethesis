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
