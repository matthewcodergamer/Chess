import { defineConfig } from '@playwright/test';

const visualProjects = [
  {
    name: 'iphone-se',
    use: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  },
  {
    name: 'iphone-11-modern',
    use: { viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  },
  {
    name: 'tablet',
    use: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, isMobile: false, hasTouch: true },
  },
  {
    name: 'laptop',
    use: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  },
  {
    name: 'desktop',
    use: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  },
] as const;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /visual-regression\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // One worker per canonical viewport keeps each project internally ordered while
  // allowing the five device classes to finish in parallel in CI.
  workers: process.env.CI ? 5 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.18,
      maxDiffPixelRatio: 0.0025,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'America/Jamaica',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: visualProjects,
  outputDir: 'test-results/visual',
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
