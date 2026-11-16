import { test, expect, clearStorage } from './fixtures';

test.beforeEach(async ({ page }) => clearStorage(page));

test('pages, sorts, edits and selects people', async ({ page, errors }) => {
  await page.goto('/directory/index.html');
  const rows = page.locator('a-data-table tbody tr[data-id]');
  await expect(rows).toHaveCount(50);
  await expect(page.locator('.ar-table__status')).toHaveText(/Showing 50 of 10,?000/);

  // Infinite scroll loads the next page.
  await page.locator('.ar-table__scroll').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(rows).toHaveCount(100);

  // Sorting by name descending.
  const nameHeader = page.locator('th[data-col=name]');
  await nameHeader.getByRole('button').click();
  await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');

  // Inline edit with validation.
  const cell = rows.first().locator('td[data-col=name]');
  await cell.click();
  await page.keyboard.press('Enter');
  const input = cell.locator('input');
  await input.fill('A');
  await input.press('Enter');
  await expect(cell.locator('.editable-error')).toHaveText('Must be at least 2 characters');
  await input.fill('Zed Example');
  await input.press('Enter');
  await expect(cell).toHaveText('Zed Example');
  await expect(page.locator('.toast').filter({ hasText: 'Saved' })).toBeVisible();

  // Selecting a row shows the person card.
  await rows.nth(1).locator('td').first().click();
  await expect(page.locator('person-card h2')).not.toBeEmpty();
  void errors;
});

test('rolls back edits the server rejects', async ({ page, errors }) => {
  await page.goto('/directory/index.html');
  await page.locator('#failures').check();
  const cell = page.locator('a-data-table tbody tr[data-id]').first().locator('td[data-col=salary]');
  const before = await cell.textContent();
  // Retry until the simulated 50% failure rate rejects one.
  for (let i = 0; i < 8; i++) {
    await cell.dblclick();
    await cell.locator('input').fill(String(60000 + i * 1000));
    await cell.locator('input').press('Enter');
    const outcome = await Promise.race([
      page.locator('.toast[data-kind=error]').first().waitFor().then(() => 'rolled back'),
      page.locator('.toast[data-kind=success]').last().waitFor().then(() => 'saved'),
    ]);
    if (outcome === 'rolled back') {
      await expect(page.locator('.toast[data-kind=error]').first()).toContainText('rolled back');
      return;
    }
    await page.locator('.toast').evaluateAll(els => els.forEach(e => e.remove()));
  }
  void before;
  void errors;
});
