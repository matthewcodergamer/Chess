import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /mobile-overlap-release-v2\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/mobile-overlap',
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-mobile-overlap-report', open: 'never' }]]
    : 'list',
  use: {
    ...devices['iPhone 13'],
    browserName: 'webkit',
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ios-safari-webkit-release-overlap',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
  webServer: {
    command: 'vite --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_MULTIPLAYER_API: 'http://127.0.0.1:4173/__qqurz_test_api',
    },
  },
});
