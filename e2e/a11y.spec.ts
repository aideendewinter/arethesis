import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

const pages = ['index.html', 'directory/index.html', 'kanban/index.html', 'editor/index.html', 'dashboard/index.html', 'signup/index.html', 'offline/index.html'];

for (const path of pages) {
  for (const theme of ['light', 'dark']) {
    test(`a11y ${path} ${theme}: no serious violations`, async ({ page, errors }) => {
      // Reduced motion turns off fade-ins, so live content (like new dashboard
      // activity) isn't measured mid-fade at partial opacity.
      await page.emulateMedia({ colorScheme: theme as 'light' | 'dark', reducedMotion: 'reduce' });
      await page.goto(`/${path}`);
      await page.waitForTimeout(1200);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
      void errors;
    });
  }
}
