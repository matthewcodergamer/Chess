import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'visual-regression.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 12_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.18,
      maxDiffPixelRatio: 0.0015,
    },
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-visual-report' }]]
    : 'list',
  outputDir: 'test-results/visual',
  snapshotPathTemplate: '{testDir}/visual-baselines/{projectName}/{arg}{ext}',
  use: {
    baseURL: BASE_URL,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      args: ['--use-angle=swiftshader'],
    },
  },
  projects: [
    {
      name: 'iphone-se',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone-11',
      use: {
        browserName: 'chromium',
        viewport: { width: 414, height: 896 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet',
      use: {
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'laptop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'vite --host 127.0.0.1 --port 4174',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_MULTIPLAYER_API: `${BASE_URL}/__qqurz_test_api`,
    },
  },
});
