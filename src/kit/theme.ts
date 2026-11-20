/**
 * Theme helpers: switch between light, dark and high contrast, remember the
 * choice, and load pages without a flash of the wrong theme.
 *
 * The theme follows the OS (`prefers-color-scheme`, `prefers-contrast`) until
 * the user picks something. A choice is stored in localStorage and applied as
 * `data-theme` / `data-contrast` on `<html>`. Add the boot snippet to `<head>`
 * so a stored choice is applied before the page first paints:
 *
 * ```html
 * <!-- either load the drop-in script… -->
 * <script src="/node_modules/arethesis/dist/theme-boot.js"></script>
 * <!-- (theme-polychrome-boot.js with the Polychrome theme) -->
 * <!-- …or inline it from your server or build: themeBootHtml() -->
 * ```
 *
 * @module kit/theme
 */

import { CRITICAL_CSS, POLYCHROME_CRITICAL_CSS } from './theme-boot.generated';

export const THEME_STORAGE_KEY = 'ar-theme';
export const CONTRAST_STORAGE_KEY = 'ar-contrast';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ContrastChoice = 'more' | 'standard' | 'system';

export interface ThemeStorageOptions {
  /** localStorage key for the theme. @default 'ar-theme' */
  themeKey?: string;
  /** localStorage key for the contrast. @default 'ar-contrast' */
  contrastKey?: string;
}

export { CRITICAL_CSS, POLYCHROME_CRITICAL_CSS };

function remember(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice still applies to this page */
  }
}

const root = (): HTMLElement => document.documentElement;
const media = (query: string): boolean => typeof matchMedia === 'function' && matchMedia(query).matches;

/** Use the light or dark theme, or follow the OS again with `'system'`. The choice is remembered. */
export function setTheme(choice: ThemeChoice, { themeKey = THEME_STORAGE_KEY }: ThemeStorageOptions = {}): void {
  if (choice === 'system') root().removeAttribute('data-theme');
  else root().setAttribute('data-theme', choice);
  remember(themeKey, choice === 'system' ? null : choice);
  root().dispatchEvent(new CustomEvent('ar-theme-change', { detail: { theme: getTheme(), contrast: getContrast() } }));
}

/** Use high contrast (`'more'`), turn it off (`'standard'`), or follow the OS with `'system'`. The choice is remembered. */
export function setContrast(choice: ContrastChoice, { contrastKey = CONTRAST_STORAGE_KEY }: ThemeStorageOptions = {}): void {
  if (choice === 'system') root().removeAttribute('data-contrast');
  else root().setAttribute('data-contrast', choice);
  remember(contrastKey, choice === 'system' ? null : choice);
  root().dispatchEvent(new CustomEvent('ar-theme-change', { detail: { theme: getTheme(), contrast: getContrast() } }));
}

/** The theme in effect: an explicit choice, or the OS preference. */
export function getTheme(): 'light' | 'dark' {
  const explicit = root().getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return media('(prefers-color-scheme: dark)') ? 'dark' : 'light';
}

/** The contrast in effect: an explicit choice, or the OS preference. */
export function getContrast(): 'more' | 'standard' {
  const explicit = root().getAttribute('data-contrast');
  if (explicit === 'more' || explicit === 'standard') return explicit;
  return media('(prefers-contrast: more)') ? 'more' : 'standard';
}

/** Re-apply stored choices (what the boot snippet does), e.g. after `<html>` was replaced. */
export function applyStoredTheme({ themeKey = THEME_STORAGE_KEY, contrastKey = CONTRAST_STORAGE_KEY }: ThemeStorageOptions = {}): void {
  try {
    const theme = localStorage.getItem(themeKey);
    const contrast = localStorage.getItem(contrastKey);
    if (theme === 'light' || theme === 'dark') root().setAttribute('data-theme', theme);
    if (contrast === 'more' || contrast === 'standard') root().setAttribute('data-contrast', contrast);
  } catch {
    /* storage unavailable */
  }
}

/** The boot script's source (no `<script>` tag), for inlining. */
export function themeBootScript({ themeKey = THEME_STORAGE_KEY, contrastKey = CONTRAST_STORAGE_KEY }: ThemeStorageOptions = {}): string {
  return `try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(themeKey)}),c=localStorage.getItem(${JSON.stringify(contrastKey)});if(t==='light'||t==='dark')d.setAttribute('data-theme',t);if(c==='more'||c==='standard')d.setAttribute('data-contrast',c)}catch(e){}`;
}

/**
 * `<style>` and `<script>` tags to put at the top of `<head>`, so the first
 * paint already has the right background, text color and theme. For servers
 * and build tools; in the browser, use the drop-in `theme-boot.js` instead.
 * Pass `nonce` if your Content Security Policy requires one, and
 * `palette: 'polychrome'` if you load theme-polychrome.css.
 */
export function themeBootHtml(options: ThemeStorageOptions & { nonce?: string; palette?: 'default' | 'polychrome' } = {}): string {
  const nonce = options.nonce ? ` nonce="${options.nonce.replace(/[^\w+/=-]/g, '')}"` : '';
  const css = options.palette === 'polychrome' ? POLYCHROME_CRITICAL_CSS : CRITICAL_CSS;
  return `<style${nonce}>${css}</style><script${nonce}>${themeBootScript(options)}</script>`;
}
