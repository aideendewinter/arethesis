/** Page chrome for the examples: navigation, theme toggle, source viewer and toasts. */
import 'arethesis/components/theme.css';
import 'arethesis/components/theme-polychrome.css';
import './fonts.css';
import './site.css';
import { VERSION } from 'arethesis';
import { applyStoredTheme, getContrast, getTheme, setContrast, setTheme, type CommandPalette, type PaletteCommand } from 'arethesis/components';

const REPO_URL = 'https://github.com/aideendewinter/arethesis';
const NPM_URL = 'https://www.npmjs.com/package/arethesis';
const GITHUB_ICON = `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

const DEMOS: Array<[string, string]> = [
  ['directory', 'Directory'],
  ['kanban', 'Kanban'],
  ['editor', 'Editor'],
  ['dashboard', 'Dashboard'],
  ['treasury', 'Treasury'],
  ['agora', 'Agora'],
  ['signup', 'Signup'],
  ['offline', 'Offline'],
];

// An alpha cut like an inscription, in an Egyptian-blue roundel ringed with cinnabar.
const LOGO = `<svg class="site-nav__logo" viewBox="0 0 32 32" aria-hidden="true"><circle class="logo__ring" cx="16" cy="16" r="15"/><circle class="logo__field" cx="16" cy="16" r="12.5"/><path class="logo__glyph" d="M10.2 22.5 16 8.6l5.8 13.9M12.4 17.6h7.2M8.6 22.5h3.4M20 22.5h3.4"/></svg>`;

export interface ShellOptions {
  /** Demo key ('directory', …) or 'home'. */
  page: string;
  title?: string;
  description?: string;
  features?: string[];
  /** Raw source of the page's script, shown in the source drawer. */
  source?: string;
  /** A short note for the footer (plain text). */
  footnote?: string;
}

/** Build the navigation and page intro; returns the main content element. */
export function mountShell(options: ShellOptions): HTMLElement {
  const prefix = options.page === 'home' ? './' : '../';
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', 'Examples');
  nav.innerHTML = `
    <a class="site-nav__brand" href="${prefix}index.html">${LOGO}<span>Arethesis</span></a>
    <div class="site-nav__links">${DEMOS.map(([key, label]) => `<a href="${prefix}${key}/index.html"${key === options.page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>
    <button class="btn btn--ghost site-nav__oracle" type="button" data-palette aria-keyshortcuts="Control+K Meta+K" title="Command palette"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.6 12.6 17 17"/></svg><span class="site-nav__oracle-label">Ask the Oracle</span><kbd aria-hidden="true">${/Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'}K</kbd></button>
    ${options.source ? '<button class="btn btn--ghost" type="button" data-source-toggle aria-expanded="false" aria-controls="source-drawer" aria-label="View source"><span class="site-nav__wide" aria-hidden="true">View source</span><span class="site-nav__narrow" aria-hidden="true">Source</span></button>' : ''}
    <a class="icon-button" href="${REPO_URL}" aria-label="Arethesis on GitHub" title="Arethesis on GitHub">${GITHUB_ICON}</a>
    <button class="icon-button" type="button" data-contrast-toggle></button>
    <button class="icon-button" type="button" data-theme-toggle></button>`;
  document.body.prepend(nav);

  // The boot snippet in <head> already applied any saved choice; this keeps it in sync after navigation.
  applyStoredTheme();
  const themeToggle = nav.querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
  const contrastToggle = nav.querySelector<HTMLButtonElement>('[data-contrast-toggle]')!;
  const renderToggles = (): void => {
    const dark = getTheme() === 'dark';
    themeToggle.textContent = dark ? '☀' : '☾';
    themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    const more = getContrast() === 'more';
    contrastToggle.textContent = '◐';
    contrastToggle.setAttribute('aria-label', 'High contrast');
    contrastToggle.setAttribute('aria-pressed', String(more));
  };
  renderToggles();
  themeToggle.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    renderToggles();
  });
  contrastToggle.addEventListener('click', () => {
    setContrast(getContrast() === 'more' ? 'standard' : 'more');
    renderToggles();
  });

  const main = document.querySelector<HTMLElement>('main') ?? document.body.appendChild(document.createElement('main'));
  main.classList.add('page');
  main.id = 'main';

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="site-footer__inner">
    <p class="site-footer__note"></p>
    <p>Every example runs entirely in your browser, against a mock backend in a SharedWorker. No marble was bleached in the making of this site.</p>
    <p class="site-footer__links">
      <span>Arethesis ${VERSION}</span>
      <a href="${REPO_URL}">GitHub</a>
      <a href="${NPM_URL}">npm</a>
      <a href="${REPO_URL}/tree/main/docs">Docs</a>
      <a href="${REPO_URL}/blob/main/CHANGELOG.md">Changelog</a>
      <a href="${REPO_URL}/blob/main/LICENSE">MIT license</a>
    </p></div>`;
  const note = footer.querySelector<HTMLElement>('.site-footer__note')!;
  if (options.footnote) note.textContent = options.footnote;
  else note.remove();
  main.after(footer);
  if (options.title) {
    const intro = document.createElement('header');
    intro.className = 'page-intro';
    const h1 = document.createElement('h1');
    h1.textContent = options.title;
    intro.appendChild(h1);
    if (options.description) {
      const p = document.createElement('p');
      p.textContent = options.description;
      intro.appendChild(p);
    }
    if (options.features?.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.setAttribute('aria-label', 'Features shown');
      for (const f of options.features) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = f;
        chips.appendChild(chip);
      }
      intro.appendChild(chips);
    }
    main.prepend(intro);
  }

  if (options.source) mountSource(nav.querySelector('[data-source-toggle]')!, options.source);
  mountPalette(nav, prefix, options, () => {
    themeToggle.click();
  }, () => contrastToggle.click());
  // The page stays hidden (see themeBoot in vite.config.ts) until its chrome is in place.
  document.body.dataset.ready = '';
  return main;
}

let paletteEl: CommandPalette | null = null;

/** The command palette on every page (Ctrl/Cmd+K). Pages add their own commands with `addCommands`. */
function mountPalette(nav: HTMLElement, prefix: string, options: ShellOptions, toggleTheme: () => void, toggleContrast: () => void): void {
  const palette = document.createElement('a-command-palette') as CommandPalette;
  palette.setAttribute('placeholder', 'Ask the Oracle: a page, an action, or something to find…');
  document.body.appendChild(palette);
  paletteEl = palette;
  nav.querySelector('[data-palette]')!.addEventListener('click', () => palette.open());
  const go = (path: string) => () => location.assign(`${prefix}${path}`);
  palette.addSource({
    id: 'pages',
    label: 'Pages',
    commands: () => [
      { id: 'page:home', title: 'Home: the Stoa', icon: 'Α', keywords: ['gallery', 'examples', 'start'], run: go('index.html') },
      ...DEMOS.filter(([key]) => key !== options.page).map(([key, label]): PaletteCommand => ({ id: `page:${key}`, title: label, icon: '→', subtitle: 'Example', run: go(`${key}/index.html`) })),
    ],
  });
  palette.addSource({
    id: 'actions',
    label: 'Actions',
    order: 1,
    commands: () => [
      { id: 'action:theme', title: getTheme() === 'dark' ? 'Use the light theme (Helios)' : 'Use the dark theme (Selene)', icon: getTheme() === 'dark' ? '☀' : '☾', keywords: ['dark mode', 'light mode', 'night', 'day'], run: toggleTheme },
      { id: 'action:contrast', title: getContrast() === 'more' ? 'Turn off high contrast' : 'Turn on high contrast', icon: '◐', keywords: ['accessibility', 'a11y'], run: toggleContrast },
      ...(options.source ? [{ id: 'action:source', title: 'View this page’s source', icon: '{ }', keywords: ['code', 'main.ts'], run: () => nav.querySelector<HTMLButtonElement>('[data-source-toggle]')!.click() }] : []),
      { id: 'action:github', title: 'Arethesis on GitHub', icon: '↗', keywords: ['repository', 'code'], run: () => window.open(REPO_URL, '_blank', 'noopener') },
      { id: 'action:docs', title: 'Read the docs', icon: '↗', keywords: ['documentation', 'guide'], run: () => window.open(`${REPO_URL}/tree/main/docs`, '_blank', 'noopener') },
      { id: 'action:npm', title: 'Arethesis on npm', icon: '↗', keywords: ['install', 'package'], run: () => window.open(NPM_URL, '_blank', 'noopener') },
    ],
  });
}

/** Add this page's own commands to the palette (shown first). */
export function addCommands(source: Parameters<CommandPalette['addSource']>[0]): () => void {
  return paletteEl?.addSource({ order: -1, ...source }) ?? (() => {});
}

function highlight(code: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return code
    .split(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/g)
    .map((part, i) => {
      if (i % 2 === 1) return `<span class="${part.startsWith('/') ? 'tok-c' : 'tok-s'}">${escape(part)}</span>`;
      return escape(part)
        .replace(/\b(import|from|export|const|let|async|await|function|return|new|class|extends|if|else|for|of|static|type|interface|true|false|null|undefined)\b/g, '<span class="tok-k">$1</span>')
        .replace(/\b(\d[\d_]*)\b/g, '<span class="tok-n">$1</span>');
    })
    .join('');
}

function mountSource(button: HTMLButtonElement, source: string): void {
  const drawer = document.createElement('aside');
  drawer.className = 'source-drawer';
  drawer.id = 'source-drawer';
  drawer.setAttribute('aria-label', 'Source code');
  drawer.inert = true;
  drawer.innerHTML = `<header><h2>main.ts</h2><button class="icon-button" type="button" aria-label="Close source">✕</button></header><pre tabindex="0"><code></code></pre>`;
  drawer.querySelector('code')!.innerHTML = highlight(source.trim());
  document.body.appendChild(drawer);
  const setOpen = (open: boolean): void => {
    drawer.toggleAttribute('data-open', open);
    drawer.inert = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) drawer.querySelector<HTMLElement>('pre')!.focus();
    else button.focus();
  };
  button.addEventListener('click', () => setOpen(!drawer.hasAttribute('data-open')));
  drawer.querySelector('header button')!.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.hasAttribute('data-open')) setOpen(false);
  });
}

let toastRegion: HTMLElement | null = null;

/** Show a short notification. */
export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  if (!toastRegion) {
    toastRegion = document.createElement('div');
    toastRegion.className = 'toasts';
    toastRegion.setAttribute('role', 'status');
    toastRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRegion);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.textContent = message;
  toastRegion.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/**
 * Pigments for avatars: Egyptian blue, cinnabar, malachite, ochre, Tyrian
 * purple, umber, verdigris, murex violet, red ochre and green earth. Each one
 * is dark enough for white initials to meet WCAG AA (7:1 or better).
 */
export const PIGMENTS = ['#1d4b98', '#a32c17', '#235f41', '#7a4e07', '#8a1a38', '#5c3a1e', '#1d5e66', '#4f2d7f', '#8c3b12', '#2f4a1c'];

/** Initials and a stable pigment for an avatar. */
export function avatar(name: string): { initials: string; color: string } {
  const initials = name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return { initials, color: PIGMENTS[hash % PIGMENTS.length] };
}

/**
 * Show a status in a pill without resizing it. Every label sits in the same
 * grid cell and only the current one is visible (hidden ones are also hidden
 * from screen readers), so the pill is always as wide as its longest label
 * and nothing next to it shifts when the status changes.
 */
export function setStatusPill(pill: HTMLElement, status: string, labels: Record<string, string>): void {
  const all = status in labels ? labels : { ...labels, [status]: status };
  const keys = Object.keys(all).join('|');
  let stack = pill.querySelector<HTMLElement>(':scope > .status-pill__labels');
  if (!stack || stack.dataset.keys !== keys) {
    stack = document.createElement('span');
    stack.className = 'status-pill__labels';
    stack.dataset.keys = keys;
    for (const [key, text] of Object.entries(all)) {
      const span = document.createElement('span');
      span.dataset.for = key;
      span.textContent = text;
      stack.appendChild(span);
    }
    pill.replaceChildren(stack);
  }
  for (const span of stack.children as HTMLCollectionOf<HTMLElement>) span.toggleAttribute('data-active', span.dataset.for === status);
  pill.dataset.status = status;
}

/** Reflect a connection status on a pill element. */
export function bindStatus(pill: HTMLElement, label: string, onStatusChange: (fn: (s: string) => void) => unknown, initial = 'connecting'): void {
  const labels = Object.fromEntries(['idle', 'connecting', 'open', 'reconnecting', 'closed'].map(s => [s, `${label}: ${s}`]));
  const set = (status: string): void => setStatusPill(pill, status, labels);
  set(initial);
  onStatusChange(set);
}
