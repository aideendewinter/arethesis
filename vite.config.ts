import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import dts from 'vite-plugin-dts';

const src = (path: string) => resolve(import.meta.dirname, 'src', path);
const elements = readdirSync(src('kit/elements')).filter(f => f.endsWith('.ts')).map(f => f.slice(0, -3));
const plugins = ['date-utils', 'async-validators', 'rich-text'];

/**
 * The npm build: one ES module per source file (`preserveModules`), so
 * bundlers tree-shake down to what an app imports. It isn't minified; the
 * app's bundler does that. The minified single-file build for `<script>` tags
 * is `vite.config.cdn.ts`.
 */
export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.json',
      entryRoot: 'src',
      exclude: ['src/**/__tests__/**'],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: src('index.ts'),
        'core/index': src('core/index.ts'),
        'realtime/index': src('realtime/index.ts'),
        'collab/index': src('collab/index.ts'),
        'mixins/index': src('mixins/index.ts'),
        'kit/index': src('kit/index.ts'),
        'kit/theme': src('kit/theme.ts'),
        ...Object.fromEntries(plugins.map(p => [`plugins/${p}`, src(`plugins/${p}.ts`)])),
        ...Object.fromEntries(elements.map(e => [`kit/elements/${e}`, src(`kit/elements/${e}.ts`)])),
      },
      formats: ['es'],
    },
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: [],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
  },
});
