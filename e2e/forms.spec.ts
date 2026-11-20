import { test, expect } from './fixtures';

test('a combobox is a form control: it searches, submits its value and resets', async ({ page, errors }) => {
  await page.goto('/signup/index.html');
  const polis = page.getByRole('combobox', { name: 'Home polis' });
  await polis.click();
  await polis.fill('spa');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Sparta' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(polis).toHaveValue('Sparta');
  // The native form sees the value, not the label.
  const value = await page.evaluate(() => new FormData(document.querySelector('form')!).get('polis'));
  expect(value).toBe('sparta');
  await page.evaluate(() => document.querySelector('form')!.reset());
  await expect(polis).toHaveValue('');
  void errors;
});
