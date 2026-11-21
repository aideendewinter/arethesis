import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software GL: deterministic rendering, and avoids GPU-process hangs on some Linux/WSL setups.
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', ...(process.env.PW_SINGLE_PROCESS ? ['--single-process', '--no-zygote'] : [])],
        },
      },
    },
    // Popups take different paths where the Popover API is missing or
    // behaves differently, so check them in the other engines too.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /(popups|text)\.spec\.ts/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /(popups|text)\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run examples:build && npm run examples:preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
