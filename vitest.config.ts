import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Legacy (experimentalDecorators) syntax for `@defineComponent` in tests.
  oxc: { decorator: { legacy: true } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/types.ts', 'src/index.ts', 'src/kit/index.ts'],
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
