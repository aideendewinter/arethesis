import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import dts from 'vite-plugin-dts';

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
        arethesis: resolve(import.meta.dirname, 'src/index.ts'),
        components: resolve(import.meta.dirname, 'src/kit/index.ts'),
      },
      formats: ['es'],
    },
    sourcemap: true,
    rollupOptions: {
      external: [],
    },
  },
});
