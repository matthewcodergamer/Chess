import { test, expect } from '@playwright/test';

const onboarding = {
  version: 1,
  completedAt: Date.now(),
  experience: 'experienced',
  boardAppearance: 'tournament',
  soundEnabled: false,
  accountCreated: false,
};

async function seedApp(page: import('@playwright/test').Page) {
  await page.addInitScript(value => {
    localStorage.setItem('qqurz:onboarding-v1', JSON.stringify(value));
    localStorage.setItem('qqurz:board-appearance', 'tournament');
  }, onboarding);
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function activate(page: import('@playwright/test').Page, name: RegExp) {
  const control = page.getByRole('button', { name });
  if (await control.count()) {
    await control.first().dispatchEvent('click');
    return;
  }
  throw new Error(`Required control is not present: ${name}`);
}

test.beforeEach(async ({ page }) => {
  await seedApp(page);
});

test('home is playable and never overflows an iPhone viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Play chess.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find an opponent', exact: true })).toBeVisible();
  const board = page.locator('[data-board-renderer="chessground"].home-live-board');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-piece-set', 'cburnett-svg');
  await expectNoHorizontalOverflow(page);
});

test('tournament screen stays inside the viewport', async ({ page }) => {
  await page.goto('/');
  await activate(page, /^(Open tournaments|Tournaments|Play a tournament)$/);
  await expect(page.getByRole('heading', { name: /Find a tournament and get in/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('home controls remain usable after scrolling and returning', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(100);
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: 'Play a friend', exact: true })).toBeVisible();
});
