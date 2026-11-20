import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { bootScript, criticalCss, loadTokens, POLYCHROME_RESOLVER_FILE, TOKENS_DIR } from '../scripts/tokens.mjs';

const root = import.meta.dirname;
const pages = ['directory', 'kanban', 'editor', 'dashboard', 'signup', 'offline'];

/**
 * Paint every page in the right colors from the very first frame, using the
 * same boot snippet the library ships (generated from the design tokens):
 * the saved theme and contrast are applied before anything renders, and the
 * page background comes from an inline style. The body also stays hidden
 * until the shell has rendered the page chrome, so it appears in one go.
 */
function themeBoot(): Plugin {
  // The examples wear the Polychrome theme.
  const loaded = loadTokens(TOKENS_DIR, POLYCHROME_RESOLVER_FILE);
  const style = [
    criticalCss(loaded),
    // Hide the half-built page until the shell marks it ready. If a script
    // fails, reveal it after 1.5s anyway rather than stay blank.
    'body:not([data-ready]){visibility:hidden;animation:ar-reveal 0s 1.5s forwards}',
    '@keyframes ar-reveal{to{visibility:visible}}',
  ].join('');
  return {
    name: 'arethesis-theme-boot',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'color-scheme', content: 'light dark' }, injectTo: 'head' },
      { tag: 'script', children: bootScript(), injectTo: 'head' },
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
      { find: /^arethesis\/components\/theme-polychrome\.css$/, replacement: resolve(root, '../src/kit/theme-polychrome.css') },
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
