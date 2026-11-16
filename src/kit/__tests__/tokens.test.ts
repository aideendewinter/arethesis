import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bootFile,
  bootScript,
  colorToCss,
  CONTEXTS,
  criticalCss,
  cssVariable,
  loadTokens,
  resolveTokens,
  tokenToCss,
  TOKENS_DIR,
  validateResolver,
  validateTokens,
  withThemeCss,
  type ResolvedToken,
} from '../../../scripts/tokens.mjs';
import {
  applyStoredTheme,
  CRITICAL_CSS,
  getContrast,
  getTheme,
  setContrast,
  setTheme,
  themeBootHtml,
  themeBootScript,
} from '../theme';

const loaded = loadTokens();
const srgb = (hex: string, alpha?: number) => ({
  colorSpace: 'srgb',
  components: [1, 3, 5].map(i => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 10000) / 10000),
  ...(alpha === undefined ? {} : { alpha }),
  hex,
});

describe('shipped design tokens', () => {
  it('are valid W3C design tokens with a valid resolver', () => {
    expect(() => loadTokens()).not.toThrow();
    expect([...loaded.files.keys()].sort()).toEqual(['base.tokens.json', 'dark-high-contrast.tokens.json', 'dark.tokens.json', 'light-high-contrast.tokens.json', 'light.tokens.json']);
  });

  it('define the same tokens in every theme context', () => {
    const paths = CONTEXTS.map(theme => [...resolveTokens(loaded, { theme }).keys()].sort());
    for (const p of paths) expect(p).toEqual(paths[0]);
    expect(paths[0]).toContain('color.bg');
    expect(paths[0]).toContain('shadow.lg');
    expect(paths[0]).toContain('font');
  });

  it('match theme.css and the generated boot CSS exactly (run `npm run tokens` after editing them)', () => {
    const css = readFileSync(resolve(TOKENS_DIR, '../theme.css'), 'utf8');
    expect(withThemeCss(css, loaded)).toBe(css);
    expect(CRITICAL_CSS).toBe(criticalCss(loaded));
  });

  // WCAG 2 relative luminance and contrast ratio.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each(CONTEXTS)('meets its contrast target in %s (AA, or AAA for high contrast)', theme => {
    const tokens = resolveTokens(loaded, { theme });
    const hex = (path: string) => colorToCss(tokens.get(path)!.value);
    const target = theme.includes('high-contrast') ? 7 : 4.5;
    const backgrounds = ['color.bg', 'color.surface', 'color.surface.2'];
    for (const fg of ['color.text', 'color.text.muted', 'color.accent', 'color.danger', 'color.success', 'color.warning']) {
      for (const bg of backgrounds) expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(target);
    }
    const pairs: Array<[string, string]> = [
      ['color.accent.text', 'color.accent'],
      ['color.accent.text', 'color.accent.hover'],
      ['color.danger.text', 'color.danger'],
      ['color.success.text', 'color.success'],
      ['color.text', 'color.accent.soft'],
      ['color.danger', 'color.danger.soft'],
      ['color.success', 'color.success.soft'],
      ['color.warning', 'color.warning.soft'],
    ];
    for (const [fg, bg] of pairs) expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(target);
    // Borders are UI components: 3:1 in high contrast.
    if (theme.includes('high-contrast')) for (const bg of backgrounds) expect(contrast(hex('color.border'), hex(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('token validation', () => {
  const tokenFile = (value: unknown, type = 'color', name = 'x') => ({ g: { $type: type, [name]: { $value: value } } });

  it('accepts the spec examples', () => {
    expect(validateTokens({ 'Hot pink': { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0, 1], alpha: 1, hex: '#ff00ff' } } })).toEqual([]);
    expect(validateTokens(tokenFile({ colorSpace: 'hsl', components: ['none', 0, 100] }))).toEqual([]);
    expect(validateTokens(tokenFile({ value: 3, unit: 'rem' }, 'dimension'))).toEqual([]);
    expect(validateTokens(tokenFile(['Helvetica', 'sans-serif'], 'fontFamily'))).toEqual([]);
    expect(validateTokens(tokenFile({ value: 200, unit: 'ms' }, 'duration'))).toEqual([]);
    expect(validateTokens(tokenFile([0.5, 0, 1, 1], 'cubicBezier'))).toEqual([]);
    expect(validateTokens(tokenFile(700, 'fontWeight'))).toEqual([]);
    expect(validateTokens(tokenFile(1.5, 'number'))).toEqual([]);
    expect(validateTokens(tokenFile('{g.y}'))).toEqual([]);
    expect(validateTokens({ g: { $type: 'dimension', $root: { $value: { value: 1, unit: 'px' } }, $description: 'ok' } })).toEqual([]);
  });

  it.each([
    ['an srgb component above 1', tokenFile({ colorSpace: 'srgb', components: [1.2, 0, 0] }), 'between 0 and 1'],
    ['a hex that is a different color', tokenFile({ colorSpace: 'srgb', components: [1, 0, 0], hex: '#00ff00' }), "doesn't match"],
    ['an 8-digit hex', tokenFile({ colorSpace: 'srgb', components: [1, 0, 0], hex: '#ff0000ff' }), '6-digit'],
    ['an unknown color space', tokenFile({ colorSpace: 'cmyk', components: [0, 0, 0] }), 'unknown colorSpace'],
    ['an alpha above 1', tokenFile({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 2 }), 'alpha'],
    ['a hex string as a color', tokenFile('#ff0000'), 'must be an object'],
    ['an unknown color property', tokenFile({ colorSpace: 'srgb', components: [0, 0, 0], extra: 1 }), 'unknown color property'],
    ['an em dimension', tokenFile({ value: 1, unit: 'em' }, 'dimension'), 'dimension must be'],
    ['an empty font list', tokenFile([], 'fontFamily'), 'fontFamily'],
    ['a font weight of 0', tokenFile(0, 'fontWeight'), 'fontWeight'],
    ['a duration in minutes', tokenFile({ value: 1, unit: 'min' }, 'duration'), 'duration'],
    ['a cubic bezier with x outside 0–1', tokenFile([2, 0, 1, 1], 'cubicBezier'), 'cubicBezier'],
    ['a string number', tokenFile('1', 'number'), 'number'],
    ['a shadow without blur', tokenFile({ color: srgb('#000000'), offsetX: { value: 0, unit: 'px' }, offsetY: { value: 0, unit: 'px' }, spread: { value: 0, unit: 'px' } }, 'shadow'), 'missing blur'],
    ['a non-boolean inset', tokenFile({ color: srgb('#000000'), offsetX: { value: 0, unit: 'px' }, offsetY: { value: 0, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 0, unit: 'px' }, inset: 'yes' }, 'shadow'), 'inset'],
    ['an empty shadow list', tokenFile([], 'shadow'), 'empty'],
    ['a token without a type', { x: { $value: 1 } }, 'no $type'],
    ['an unknown type', tokenFile(1, 'gradient'), 'unknown $type'],
    ['a name with a dot', tokenFile(1, 'number', 'a.b'), 'must not contain'],
    ['an unknown $ property on a group', { g: { $type: 'number', $color: 1 } }, 'unexpected "$color"'],
    ['an unknown property on a token', { g: { $type: 'number', x: { $value: 1, value: 2 } } }, 'unexpected "value"'],
    ['a non-string description', { g: { $type: 'number', $description: 1 } }, '$description'],
    ['a group that is not an object', { g: 1 }, 'must be an object'],
  ])('rejects %s', (_, doc, message) => {
    expect(validateTokens(doc).join('\n')).toContain(message);
  });

  const resolver = () => ({
    version: '2025-10-01',
    sets: { base: { sources: [{ $ref: 'base.tokens.json' }] } },
    modifiers: { theme: { contexts: { light: [{ $ref: 'light.tokens.json' }], dark: [{ $ref: 'dark.tokens.json' }] }, default: 'light' } },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  });

  it('checks resolver documents', () => {
    expect(validateResolver(resolver())).toEqual([]);
    expect(validateResolver({ ...resolver(), version: '2025-11-01' })).toEqual(['version must be "2025-10-01"']);
    expect(validateResolver({ ...resolver(), resolutionOrder: [] }).join()).toContain('non-empty');
    expect(validateResolver({ ...resolver(), resolutionOrder: [{ $ref: '#/sets/nope' }] }).join()).toContain("doesn't point at");
    const r = resolver();
    r.modifiers.theme.default = 'sepia';
    expect(validateResolver(r).join()).toContain('is not a context');
    expect(validateResolver({ ...resolver(), modifiers: { theme: { contexts: {} } } }).join()).toContain('no contexts');
    expect(validateResolver(resolver(), file => file !== 'dark.tokens.json').join()).toContain('dark.tokens.json not found');
    expect(validateResolver({ ...resolver(), sets: { base: { sources: 'base.tokens.json' } } }).join()).toContain('array of sources');
    expect(validateResolver({ ...resolver(), sets: { base: { sources: [1] } } }).join()).toContain('each source');
    expect(validateResolver(null)).toEqual(['resolver must be an object']);
  });

  it('fails to load a folder without a resolver', () => {
    expect(() => loadTokens(resolve(TOKENS_DIR, '../../..', 'test'))).toThrow();
  });
});

describe('resolving and CSS', () => {
  const custom = (light: Record<string, unknown>) => ({
    resolver: {
      version: '2025-10-01',
      modifiers: { theme: { contexts: { light: [light], dark: [{ c: { $type: 'number', $value: 2 } }] }, default: 'light' } },
      resolutionOrder: [{ $ref: '#/modifiers/theme' }],
    },
    files: new Map(),
  });

  it('follows {references}, and the modifier input is case-insensitive', () => {
    const tokens = resolveTokens(custom({ a: { $type: 'number', $value: 1 }, b: { $type: 'number', $value: '{a}' }, c: { $type: 'number', $value: '{b}' } }), { THEME: 'light' });
    expect(tokens.get('c')!.value).toBe(1);
    expect(resolveTokens(custom({}), { theme: 'dark' }).get('c')!.value).toBe(2);
  });

  it('rejects circular and unknown references, and unknown contexts', () => {
    expect(() => resolveTokens(custom({ a: { $type: 'number', $value: '{b}' }, b: { $type: 'number', $value: '{a}' } }))).toThrow('Circular reference');
    expect(() => resolveTokens(custom({ a: { $type: 'number', $value: '{nope}' } }))).toThrow('Unknown reference');
    expect(() => resolveTokens(loaded, { theme: 'sepia' })).toThrow('Unknown theme "sepia"');
  });

  it('names custom properties after the token path', () => {
    expect(cssVariable('color.text.muted')).toBe('--ar-text-muted');
    expect(cssVariable('color.bg')).toBe('--ar-bg');
    expect(cssVariable('radius.sm')).toBe('--ar-radius-sm');
    expect(cssVariable('shadow')).toBe('--ar-shadow');
  });

  it('converts each token type to CSS', () => {
    const css = (type: string, value: unknown) => tokenToCss({ type, value } as ResolvedToken);
    expect(css('color', srgb('#4f46e5'))).toBe('#4f46e5');
    expect(css('color', srgb('#101828', 0.06))).toBe('rgb(16 24 40 / 0.06)');
    expect(css('color', { colorSpace: 'srgb', components: [1, 0, 0] })).toBe('#ff0000');
    expect(css('color', { colorSpace: 'oklch', components: [0.7, 0.1, 250], alpha: 0.5 })).toBe('oklch(0.7 0.1 250 / 0.5)');
    expect(css('color', { colorSpace: 'display-p3', components: [1, 0, 0] })).toBe('color(display-p3 1 0 0)');
    expect(css('dimension', { value: 0, unit: 'px' })).toBe('0');
    expect(css('dimension', { value: 1.5, unit: 'rem' })).toBe('1.5rem');
    expect(css('fontFamily', ['system-ui', 'Segoe UI', "O'Font", 'sans-serif'])).toBe("system-ui, 'Segoe UI', 'O\\'Font', sans-serif");
    expect(css('fontFamily', 'Inter')).toBe("'Inter'");
    expect(css('fontWeight', 600)).toBe('600');
    expect(css('number', 1.25)).toBe('1.25');
    expect(css('duration', { value: 200, unit: 'ms' })).toBe('200ms');
    expect(css('cubicBezier', [0.4, 0, 0.2, 1])).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    const px = (value: number) => ({ value, unit: 'px' });
    expect(css('shadow', { color: srgb('#000000', 0.5), offsetX: px(0), offsetY: px(2), blur: px(4), spread: px(0), inset: true })).toBe('inset 0 2px 4px 0 rgb(0 0 0 / 0.5)');
    expect(() => css('gradient', [])).toThrow('No CSS');
  });
});

describe('theme boot and helpers', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-contrast');
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('inlines the same boot script as the drop-in file', () => {
    expect(themeBootScript()).toBe(bootScript());
    expect(themeBootScript({ themeKey: 'my-theme', contrastKey: 'my-contrast' })).toBe(bootScript({ themeKey: 'my-theme', contrastKey: 'my-contrast' }));
    const html = themeBootHtml({ nonce: 'abc"><script>' });
    expect(html).toContain(`<style nonce="abcscript">${CRITICAL_CSS}</style>`);
    expect(html).toContain('<script nonce="abcscript">try{');
    expect(themeBootHtml()).toMatch(/^<style>.*<\/style><script>.*<\/script>$/);
  });

  it('applies the stored theme and contrast before paint (drop-in script)', () => {
    localStorage.setItem('ar-theme', 'dark');
    localStorage.setItem('ar-contrast', 'more');
    new Function(bootFile(loaded))();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.contrast).toBe('more');
    const style = document.head.querySelector('style[data-arethesis-boot]')!;
    expect(style.textContent).toBe(CRITICAL_CSS);
    style.remove();
    // Unknown stored values are ignored.
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('ar-theme', 'sepia');
    new Function(themeBootScript())();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('switches, remembers and reports the theme and contrast', () => {
    const listener = vi.fn();
    document.documentElement.addEventListener('ar-theme-change', listener);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' }));
    expect(getTheme()).toBe('dark'); // follows the OS
    expect(getContrast()).toBe('standard');
    setTheme('light');
    expect(getTheme()).toBe('light');
    expect(localStorage.getItem('ar-theme')).toBe('light');
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { theme: 'light', contrast: 'standard' } }));
    setContrast('more');
    expect(getContrast()).toBe('more');
    expect(document.documentElement.dataset.contrast).toBe('more');
    expect(localStorage.getItem('ar-contrast')).toBe('more');
    setTheme('system');
    setContrast('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('ar-theme')).toBeNull();
    expect(localStorage.getItem('ar-contrast')).toBeNull();
    expect(getTheme()).toBe('dark');
    // Custom keys, and re-applying stored choices.
    setTheme('dark', { themeKey: 'k' });
    expect(localStorage.getItem('k')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    applyStoredTheme({ themeKey: 'k' });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('still works when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    setTheme('dark');
    expect(getTheme()).toBe('dark');
    expect(() => applyStoredTheme()).not.toThrow();
    vi.restoreAllMocks();
  });
});
