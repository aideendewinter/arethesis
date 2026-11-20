import { test, expect } from './fixtures';

const cell = (page: import('@playwright/test').Page, addr: string) => page.locator(`a-sheet td[data-addr="${addr}"]`);

test('edits with the keyboard and recalculates formulas', async ({ page, errors }) => {
  await page.goto('/treasury/index.html');
  await expect(cell(page, 'C15')).toHaveText('160.67');
  const grid = page.getByRole('grid', { name: 'Treasury ledger' });
  await grid.focus();
  // Move to C2 with arrows (moving only selects), type to replace, arrow down saves and moves.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ar-sheet__name')).toHaveText('C2');
  await page.keyboard.type('40');
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 'C2')).toHaveText('40');
  await expect(cell(page, 'D2')).toHaveText('240,000 dr.');
  await expect(cell(page, 'C15')).toHaveText('170.67');
  await expect(page.locator('.ar-sheet__name')).toHaveText('C3');

  // A cycle is an error, not a hang; undo restores the value.
  await page.keyboard.type('=C15');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'C3')).toHaveText('#CYCLE!');
  await expect(cell(page, 'C15')).toHaveText('#CYCLE!');
  await grid.focus();
  await page.keyboard.press('Control+z');
  await expect(cell(page, 'C3')).toHaveText('30');
  await expect(cell(page, 'C15')).toHaveText('170.67');
  void errors;
});

test('pastes a range from another app and fills formulas down', async ({ page, errors }) => {
  await page.goto('/treasury/index.html');
  await expect(cell(page, 'C15')).toHaveText('160.67');
  await cell(page, 'H2').click();
  await page.keyboard.press('Escape'); // leave the editor that a click opens
  await page.getByRole('grid').evaluate(grid => {
    const data = new DataTransfer();
    data.setData('text/plain', '1\t2\n3\t4\n');
    grid.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.ar-sheet__name')).toHaveText('H2:I3');
  await expect(cell(page, 'I3')).toHaveText('4');

  // A formula in G2, filled down to G4 with Ctrl+D: references shift.
  await cell(page, 'G2').click();
  await page.keyboard.type('=C2*2');
  await page.keyboard.press('Escape');
  await expect(cell(page, 'G2')).toHaveText('');
  await cell(page, 'G2').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('=C2*2');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'G2')).toHaveText('60');
  await page.getByRole('grid').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Control+d');
  await expect(cell(page, 'G4')).toHaveText('36');
  await expect(page.locator('.ar-sheet__formula')).toHaveValue('=C4*2'); // the active cell is G4: its reference shifted
  void errors;
});

test('edits made in one window appear in another', async ({ context, page, errors }) => {
  const other = await context.newPage();
  await page.goto('/treasury/index.html');
  await other.goto('/treasury/index.html');
  await expect(cell(other, 'C15')).toHaveText(/\d/);
  await cell(page, 'B5').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Propontis');
  await page.keyboard.press('Enter');
  await expect(cell(other, 'B5')).toHaveText('Propontis', { timeout: 10_000 });
  void errors;
});
