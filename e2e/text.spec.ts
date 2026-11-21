import { test, expect, clearStorage } from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => clearStorage(page));

const fragments = (page: Page) => page.locator('.reader__fragments');
/** How many ranges a native highlight holds (0 when there's none). */
const highlightSize = (page: Page, name: string) => page.evaluate(n => (CSS as unknown as { highlights?: Map<string, Set<unknown>> }).highlights?.get(n)?.size ?? 0, name);

/** Select `phrase` (its first occurrence, or the part from `from` to `to` within it) in the fragments, as a user dragging would. */
async function selectText(page: Page, phrase: string, from = 0, to = phrase.length): Promise<string> {
  return page.evaluate(([needle, a, b]) => {
    const root = document.querySelector('.reader__fragments')!;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    const full = nodes.map(n => n.data).join('');
    const start = full.indexOf(needle) + a;
    const end = full.indexOf(needle) + b;
    const range = document.createRange();
    let seen = 0;
    for (const n of nodes) {
      const len = n.data.length;
      if (seen <= start && start < seen + len) range.setStart(n, start - seen);
      if (seen < end && end <= seen + len) range.setEnd(n, end - seen);
      seen += len;
    }
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  }, [phrase, from, to] as const);
}

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test('search highlights matches without changing the page', async ({ page, errors }) => {
  await page.goto('/reader/index.html');
  const before = await fragments(page).innerHTML();
  await page.locator('#find').fill('logos');
  await expect(page.locator('#find-count')).toHaveText('1 of 2');
  expect(await highlightSize(page, 'ar-search')).toBe(2);
  expect(await highlightSize(page, 'ar-search-current')).toBe(1);
  expect(await fragments(page).innerHTML()).toBe(before);
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-count')).toHaveText('2 of 2');
  // Escape in the field clears the search.
  await page.keyboard.press('Escape');
  await expect(page.locator('#find')).toHaveValue('');
  expect(await highlightSize(page, 'ar-search')).toBe(0);
  void errors;
});

test('without the Highlight API, marks are wrapped and unwrapped cleanly', async ({ page, errors }) => {
  await page.addInitScript(() => {
    Object.defineProperty(CSS, 'highlights', { value: undefined, configurable: true });
  });
  await page.goto('/reader/index.html');
  const before = await fragments(page).innerHTML();
  await page.locator('#find').fill('the');
  await expect(page.locator('#find-count')).toContainText(' of ');
  const marks = fragments(page).locator('mark.ar-highlight[data-highlight="ar-search"]');
  expect(await marks.count()).toBeGreaterThan(3);
  expect(await fragments(page).textContent()).toContain('the same for all');
  await page.locator('#find').fill('');
  await expect(marks).toHaveCount(0);
  expect(await fragments(page).innerHTML()).toBe(before);
  void errors;
});

test('the selection menu keeps the selection, marks it, and the mark is remembered', async ({ page, errors }) => {
  await page.goto('/reader/index.html');
  const selected = await selectText(page, 'Listening');
  expect(selected).toBe('Listening');
  const menu = page.getByRole('toolbar', { name: 'Selection actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Mark', exact: true }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('Listening');
  await expect.poll(() => highlightSize(page, 'reader-mark')).toBe(1);
  // Remembered across reloads.
  await page.reload();
  await expect.poll(() => highlightSize(page, 'reader-mark')).toBe(1);
  // From the keyboard: Shift+F10 moves into the menu, Escape returns with the selection intact.
  await selectText(page, 'Listening', 3);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Shift+F10');
  await expect(menu.getByRole('button', { name: 'Mark', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(menu.getByRole('button', { name: 'Unmark' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => highlightSize(page, 'reader-mark')).toBe(0);
  void errors;
});

test('shortcuts: help lists them, they skip text fields, and Escape closes the top layer first', async ({ page, errors }) => {
  await page.goto('/reader/index.html');
  await blur(page);
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  // "Next match" is listed only while there are matches.
  await expect(help.locator('dd')).toContainText(['Find in text', 'Clear the search', 'Follow along', 'Keyboard shortcuts']);
  await expect(help.locator('dd', { hasText: 'Next match' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // Typing a shortcut's key in a field just types it.
  await page.keyboard.press('/');
  await expect(page.locator('#find')).toBeFocused();
  await page.keyboard.type('s?');
  await expect(page.locator('#find')).toHaveValue('s?');
  await expect(help).toBeHidden();
  await expect(page.locator('#settings')).toBeHidden();

  // The settings panel is a layer: Escape closes it, and leaves the search alone.
  await page.locator('#find').fill('fire');
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('#find')).toHaveValue('fire');
  void errors;
});

test('settings are saved and follow other tabs', async ({ context, page, errors }) => {
  const other = await context.newPage();
  await page.goto('/reader/index.html');
  await other.goto('/reader/index.html');
  await page.locator('#settings-toggle').click();
  await page.locator('#leading').selectOption('2');
  await expect.poll(() => other.locator('.reader__fragments').evaluate(el => (el as HTMLElement).style.lineHeight)).toBe('2');
  await blur(page);
  await page.keyboard.press('+');
  await expect(fragments(page)).toHaveCSS('font-size', '20px');
  await expect(fragments(other)).toHaveCSS('font-size', '20px');
  void errors;
});

/** The text of the word follow-along is on. */
const followed = (page: Page) => page.evaluate(() => {
  const native = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get('reader-word');
  return native ? [...native][0]?.toString() ?? '' : document.querySelector('mark[data-highlight="reader-word"]')?.textContent ?? '';
});

/** The centre of a word in the fragments, in viewport coordinates. */
const wordPoint = (page: Page, word: string) => page.evaluate(w => {
  const root = document.querySelector('.reader__fragments')!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n as Text).data.search(new RegExp(`\\b${w}\\b`));
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(n, at);
    range.setEnd(n, at + w.length);
    range.startContainer.parentElement!.scrollIntoView({ block: 'center' });
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  throw new Error(`no ${w}`);
}, word);

test('while following along, a click on a word (a Range, not a span) reads on from there', async ({ page, errors }) => {
  await page.goto('/reader/index.html');
  const before = await fragments(page).innerHTML();
  await page.locator('#follow').click();
  await expect.poll(() => followed(page)).toBe('Listening');
  const river = await wordPoint(page, 'river');
  await page.mouse.click(river.x, river.y);
  // It reads on, so by the time we look it may be a word or two further.
  await expect.poll(() => followed(page)).toMatch(/^(river|other|and|still|waters|flow|on)$/);
  // From the keyboard: the passage takes focus and the arrows move word by word.
  await fragments(page).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => highlightSize(page, 'reader-hover')).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => followed(page)).toMatch(/^(Listening|not|to|me|but|the|logos)$/);
  await page.locator('#follow').click();
  expect(await fragments(page).innerHTML()).toBe(before);
  void errors;
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox has no touch emulation');

  test('a tap shows a gloss, a second tap hides it, and a swipe does nothing', async ({ page, errors }) => {
    await page.goto('/reader/index.html');
    const term = page.locator('dfn.gloss', { hasText: 'logos' }).first();
    const gloss = page.getByRole('tooltip');
    await term.tap();
    await expect(gloss).toBeVisible();
    await expect(gloss).toContainText('Word, account, reason');
    await expect(gloss).toHaveClass(/is-pinned/);
    await term.tap();
    await expect(gloss).toBeHidden();
    // Another term moves it there.
    await term.tap();
    await page.locator('dfn.gloss', { hasText: 'kosmos' }).tap();
    await expect(gloss).toContainText('Order, arrangement');
    void errors;
  });
});
