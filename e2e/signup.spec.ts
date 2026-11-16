import { test, expect } from './fixtures';

test('validates on submit, checks usernames and maps server errors', async ({ page, errors }) => {
  await page.goto('/signup/index.html');
  await page.getByRole('button', { name: 'Create account' }).click();
  const summary = page.locator('[data-error-summary]');
  await expect(summary).toBeVisible();
  await expect(summary.locator('li').first()).toBeVisible();
  await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');

  await page.locator('#name').fill('Alice Hopper');
  await page.locator('#email').fill('alice@example.com');
  await page.locator('#username').fill('alice');
  await page.locator('#username').blur();
  await expect(page.locator('#username')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('That username is taken')).toBeVisible();
  await page.locator('#username').fill('alice_h');
  await page.locator('#username').blur();
  await expect(page.locator('#username')).not.toHaveAttribute('aria-invalid', 'true');

  // Role via the accessible combobox.
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Engineer' }).click();

  await page.locator('#password').fill('correcthorse1');
  await page.locator('#confirm').fill('correcthorse1');
  await page.locator('#birthday').fill('1990-12-10');
  await page.locator('.rich-text__content').click();
  await page.keyboard.type('Builds compilers and tells bad puns.');
  await page.getByLabel('I agree to the (imaginary) terms').check();

  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('example.com addresses can’t receive mail')).toBeVisible();

  await page.locator('#email').fill('alice@example.org');
  // Wait for the server error to clear so the layout settles before clicking.
  await expect(page.locator('#email')).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#result')).toContainText('Account created');
  await expect(page.locator('#result pre')).toContainText('alice_h');
  void errors;
});
