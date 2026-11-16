/** Page chrome for the examples: navigation, theme toggle, source viewer and toasts. */
import './site.css';
import 'arethesis/components/theme.css';

const DEMOS: Array<[string, string]> = [
  ['directory', 'Directory'],
  ['kanban', 'Kanban'],
  ['editor', 'Collaborative editor'],
  ['dashboard', 'Live dashboard'],
  ['signup', 'Signup form'],
  ['offline', 'Offline & caching'],
];

const LOGO = `<svg class="site-nav__logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><path d="M9 23 16 8l7 15M11.8 17.5h8.4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function applyTheme(theme: string | null): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

try {
  applyTheme(localStorage.getItem('ar-theme'));
} catch {
  /* storage unavailable */
}

export interface ShellOptions {
  /** Demo key ('directory', …) or 'home'. */
  page: string;
  title?: string;
  description?: string;
  features?: string[];
  /** Raw source of the page's script, shown in the source drawer. */
  source?: string;
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
    ${options.source ? '<button class="btn btn--ghost" type="button" data-source-toggle aria-expanded="false" aria-controls="source-drawer">View source</button>' : ''}
    <button class="icon-button" type="button" data-theme-toggle></button>`;
  document.body.prepend(nav);

  const toggle = nav.querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
  const renderToggle = (): void => {
    const dark = currentTheme() === 'dark';
    toggle.textContent = dark ? '☀' : '☾';
    toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  renderToggle();
  toggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('ar-theme', next);
    } catch {
      /* ignore */
    }
    renderToggle();
  });

  const main = document.querySelector<HTMLElement>('main') ?? document.body.appendChild(document.createElement('main'));
  main.classList.add('page');
  main.id = 'main';
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
  // The page stays hidden (see themeBoot in vite.config.ts) until its chrome is in place.
  document.body.dataset.ready = '';
  return main;
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

/** Initials and a stable color for an avatar. */
export function avatar(name: string): { initials: string; color: string } {
  const initials = name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  // Dark enough for white text to meet WCAG AA (4.5:1) at every hue.
  return { initials, color: `hsl(${hash % 360} 55% 29%)` };
}

/** Reflect a connection status on a pill element. */
export function bindStatus(pill: HTMLElement, label: string, onStatusChange: (fn: (s: string) => void) => unknown, initial = 'connecting'): void {
  const set = (status: string): void => {
    pill.dataset.status = status;
    pill.textContent = `${label}: ${status}`;
  };
  set(initial);
  onStatusChange(set);
}
