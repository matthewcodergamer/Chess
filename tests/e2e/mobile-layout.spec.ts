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
  await expect(page.getByRole('button', { name: 'Find an opponent', exact: true }).first()).toBeVisible();
  const board = page.locator('[data-board-renderer="chessground"].home-live-board');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-piece-set', 'cburnett-svg');
  await expectNoHorizontalOverflow(page);
});


test('brand and navigation stay polished on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.qqurz-wordmark .wordmark-pawn')).toBeVisible();
  await expect(page.getByRole('button', { name: 'qqurzchess home' })).toContainText('QQURZ Chess');
  await expect(page.locator('.desktop-chess-nav')).toBeVisible();
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


test('presence outages stay silent and do not replace the home screen', async ({ page }) => {
  await page.route('**/presence*', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Play chess.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find an opponent', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Online services are temporarily unavailable', { exact: true })).not.toBeVisible();
  await expect(page.locator('.qqurz-home-v24')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('online player count opens a contained scrollable live player list', async ({ page }) => {
  const players = Array.from({ length: 10 }, (_, index) => ({
    name: ['GreenRook475', 'Chess960', 'KnightWave', 'RookRunner', 'QuietBishop', 'CastleKing', 'OpenFile', 'RapidKnight', 'EndgameFox', 'TacticalPawn'][index],
    state: index === 1 || index === 8 ? 'game' : index === 5 ? 'away' : 'online',
  }));
  await page.route('**/__qqurz_test_api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/presence/players')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onlinePlayers: players.length, presence: { online: 8, away: 1, game: 2 }, players }) });
      return;
    }
    if (url.pathname.endsWith('/presence/ping')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onlinePlayers: players.length, presence: { online: 8, away: 1, game: 2 } }) });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  const onlineButton = page.locator('.home-online-status');
  await expect(onlineButton).toBeVisible();
  await expect(onlineButton).toContainText('10 online', { timeout: 20_000 });
  await expect(onlineButton).toContainText('Chess960 players');
  await onlineButton.click();

  const popover = page.getByRole('region', { name: 'Online players' });
  const list = popover.locator('ul');
  await expect(popover).toBeVisible();
  await expect(popover.getByText('GreenRook475', { exact: true })).toBeVisible();
  await expect(popover.getByText('Chess960', { exact: true })).toBeVisible();
  await expect(popover.getByText('KnightWave', { exact: true })).toBeVisible();

  const metrics = await list.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    rowCount: element.querySelectorAll(':scope > li').length,
  }));
  if (metrics.rowCount !== 10) throw new Error(`expected 10 player rows, got ${metrics.rowCount}`);
  if (metrics.scrollHeight <= metrics.clientHeight) throw new Error('online player list should scroll inside the popover');
  if (metrics.clientHeight > 260) throw new Error(`online player list exposes too many rows at once: ${metrics.clientHeight}px`);

  const bounds = await popover.boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('could not measure online player popover');
  if (bounds.x < 0 || bounds.x + bounds.width > viewport.width) {
    throw new Error(`online player popover overflows viewport: x=${bounds.x}, width=${bounds.width}, viewport=${viewport.width}`);
  }
});


test('matchmaking screen has a clear mobile hierarchy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Find an opponent/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Find an opponent.' })).toBeVisible();
  await expect(page.getByText('Chess960 · 10+5', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
