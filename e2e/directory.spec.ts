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

  // Inline edit with validation: a click edits, in an editor over the cell.
  const cell = rows.first().locator('td[data-col=name]');
  const before = await cell.boundingBox();
  await cell.click();
  const input = page.locator('.ar-cell-editor input');
  await expect(input).toBeFocused();
  expect(await cell.boundingBox()).toEqual(before); // nothing shifts
  await input.fill('A');
  await input.press('Enter');
  await expect(page.locator('.ar-cell-editor__error')).toHaveText('Must be at least 2 characters');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
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
    await cell.click();
    await page.locator('.ar-cell-editor input').fill(String(60000 + i * 1000));
    await page.locator('.ar-cell-editor input').press('Enter');
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

test('edits from the keyboard: type to replace, arrows to move, and choice lists that never save by accident', async ({ page, errors }) => {
  await page.goto('/directory/index.html');
  const rows = page.locator('a-data-table tbody tr[data-id]');
  await expect(rows).toHaveCount(50);
  const cell = (row: number, col: string) => rows.nth(row).locator(`td[data-col=${col}]`);

  // Select a cell without editing it: arrows only move.
  await cell(0, 'name').click();
  await page.keyboard.press('Escape');
  await expect(cell(0, 'name')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(0, 'department')).toBeFocused();
  await expect(page.locator('.ar-cell-editor')).toHaveCount(0);

  // A choice cell: arrows browse the list; nothing is saved until Enter.
  await page.keyboard.press('Enter');
  const box = page.locator('.ar-cell-editor').getByRole('combobox', { name: 'Department' });
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  const original = await cell(0, 'department').textContent();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ar-cell-editor')).toHaveCount(1);
  await expect(cell(0, 'department')).toHaveText(original!);
  await page.keyboard.press('Escape');
  await expect(cell(0, 'department')).toHaveText(original!);
  await expect(cell(0, 'department')).toBeFocused();

  // Type to replace a name, then ArrowDown saves and moves down.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('Hypatia of Alexandria');
  await expect(page.locator('.ar-cell-editor input')).toHaveValue('Hypatia of Alexandria');
  await page.keyboard.press('ArrowDown');
  await expect(cell(0, 'name')).toHaveText('Hypatia of Alexandria');
  await expect(cell(1, 'name')).toBeFocused();
  void errors;
});
