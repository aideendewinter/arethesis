import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const pages = ['directory', 'kanban', 'editor', 'dashboard', 'signup', 'offline'];

/**
 * Paint every page in the right colors from the very first frame. The saved
 * theme is applied by an inline script before anything renders, and the page
 * background comes from an inline style (read from theme.css so the values
 * can't drift). Without this, a page painted white until its modules ran,
 * which flashed on every navigation in dark mode and in the dev server. The
 * body also stays hidden until the shell has rendered the page chrome.
 */
function themeBoot(): Plugin {
  const css = readFileSync(resolve(root, '../src/kit/theme.css'), 'utf8');
  const token = (block: string, name: string): string => {
    const start = css.indexOf(block);
    const match = new RegExp(`--ar-${name}:\\s*([^;]+);`).exec(css.slice(start));
    if (start === -1 || !match) throw new Error(`themeBoot: --ar-${name} not found in ${block}`);
    return match[1].trim();
  };
  const light = { bg: token(':root {', 'bg'), text: token(':root {', 'text') };
  const dark = { bg: token(":root[data-theme='dark']", 'bg'), text: token(":root[data-theme='dark']", 'text') };
  const paint = (t: { bg: string; text: string }, scheme: string) => `background:${t.bg};color:${t.text};color-scheme:${scheme}`;
  const style = [
    `html{${paint(light, 'light')}}`,
    `@media (prefers-color-scheme: dark){html:not([data-theme=light]){${paint(dark, 'dark')}}}`,
    `html[data-theme=dark]{${paint(dark, 'dark')}}`,
    // Hide the half-built page until the shell marks it ready, so it appears in one
    // go. If a script fails, reveal it after 1.5s anyway rather than stay blank.
    'body:not([data-ready]){visibility:hidden;animation:ar-reveal 0s 1.5s forwards}',
    '@keyframes ar-reveal{to{visibility:visible}}',
  ].join('');
  const script = `try{var t=localStorage.getItem('ar-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
  return {
    name: 'arethesis-theme-boot',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'color-scheme', content: 'light dark' }, injectTo: 'head' },
      { tag: 'script', children: script, injectTo: 'head' },
      { tag: 'style', children: style, injectTo: 'head' },
    ],
  };
}

export default defineConfig({
  root,
  base: './',
  oxc: { decorator: { legacy: true } },
  plugins: [themeBoot()],
  resolve: {
    alias: [
      { find: /^arethesis\/components\/theme\.css$/, replacement: resolve(root, '../src/kit/theme.css') },
      { find: /^arethesis\/components$/, replacement: resolve(root, '../src/kit/index.ts') },
      { find: /^arethesis$/, replacement: resolve(root, '../src/index.ts') },
    ],
  },
  worker: { format: 'es' },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries([['index', resolve(root, 'index.html')], ...pages.map(p => [p, resolve(root, `${p}/index.html`)])]),
    },
  },
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true },
});
