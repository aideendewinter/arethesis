import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Minified bundles for `<script type="module">` (CDNs, islands without a
 * bundler): `dist/cdn/arethesis.min.js` and `dist/cdn/components.min.js`.
 * They're built together so they share one copy of the core (the runtime,
 * mixin registry and template loader are singletons).
 */
export default defineConfig({
  build: {
    outDir: 'dist/cdn',
    emptyOutDir: true,
    lib: {
      entry: {
        arethesis: resolve(import.meta.dirname, 'src/index.ts'),
        components: resolve(import.meta.dirname, 'src/kit/index.ts'),
      },
      formats: ['es'],
    },
    sourcemap: true,
    minify: true,
    rollupOptions: {
      // The full bundle imports the optional services statically as well, so
      // init()'s lazy imports can't split them out here. That's expected.
      onwarn(warning, warn) {
        if (warning.code !== 'INEFFECTIVE_DYNAMIC_IMPORT') warn(warning);
      },
      output: {
        entryFileNames: '[name].min.js',
        chunkFileNames: 'chunks/[hash].min.js',
        // Library mode keeps whitespace by default; this is for direct use, so minify fully.
        minify: true,
      },
    },
  },
});
