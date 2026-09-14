import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const FIXED_NOW = Date.UTC(2026, 8, 14, 12, 0, 0);

const visualState = {
  fairPlayAccepted: true,
};

const ratingState = (rating: number, games: number) => ({
  rating,
  deviation: games ? 72 : 350,
  volatility: 0.06,
  games,
  wins: Math.floor(games * 0.55),
  draws: Math.floor(games * 0.15),
  losses: games - Math.floor(games * 0.55) - Math.floor(games * 0.15),
  provisional: games < 10,
  lastRatedAt: games ? FIXED_NOW - 86_400_000 : null,
});

const mockAccount = {
  id: 'visual-player',
  email: 'visual@example.invalid',
  emailVerifiedAt: FIXED_NOW - 2_592_000_000,
  username: 'visual-tester',
  displayName: 'Visual Tester',
  countryCode: 'JM',
  avatar: '♞',
  avatarImage: null,
  ratingModel: 'glicko2',
  chess960Ratings: {
    rapid: ratingState(1642, 28),
    blitz: ratingState(1588, 19),
    bullet: ratingState(1510, 7),
  },
  rating: 1642,
  chess960Rating: 1642,
  gamesPlayed: 54,
  wins: 30,
  draws: 8,
  losses: 16,
  createdAt: FIXED_NOW - 15_552_000_000,
  updatedAt: FIXED_NOW,
  privacy: {
    profileVisibility: 'public',
    showCountry: true,
    showHistory: true,
    allowChallenges: true,
  },
  notifications: {
    gameInvites: true,
    tournamentUpdates: true,
    results: true,
    productUpdates: false,
  },
  settings: {
    language: 'en',
    timezone: 'America/Jamaica',
  },
  blockedPlayerIds: [],
  gameHistory: [],
  tournamentHistory: [],
  trophies: [],
  sessionCount: 1,
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function seedApp(page: Page) {
  await page.addInitScript(({ now }) => {
    localStorage.setItem('qqurz:onboarding-v1', JSON.stringify({
      version: 1,
      completedAt: now,
      experience: 'tournament',
      boardAppearance: 'tournament',
      soundEnabled: false,
      accountCreated: true,
    }));
    localStorage.setItem('qqurz:board-appearance', 'tournament');
    localStorage.setItem('qqurz:theme', 'dark');
    localStorage.setItem('qqurz:font-scale', 'default');
    localStorage.setItem('qqurz:clock-visible', 'true');
    localStorage.setItem('qqurz:account-token', 'visual-account-token');
    localStorage.setItem('qqurz:presence-id', 'visual-presence-id-000001');
    localStorage.setItem('qqurz:profile', JSON.stringify({ username: 'Visual Tester', avatar: '♞' }));

    try {
      Object.defineProperty(window.crypto, 'getRandomValues', {
        configurable: true,
        value: (array: Uint32Array) => {
          array.fill(518);
          return array;
        },
      });
    } catch {
      // The screenshots stay deterministic on browsers where Web Crypto can be patched.
    }
  }, { now: FIXED_NOW });
}

async function installApi(page: Page) {
  await page.route('**/__qqurz_test_api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/__qqurz_test_api', '');

    if (path === '/presence/ping') {
      return json(route, {
        onlinePlayers: 42,
        presence: { online: 34, away: 5, game: 3 },
      });
    }

    if (path === '/tournaments') {
      return json(route, {
        tournaments: [],
        paymentMode: 'off',
        paymentConfigured: false,
        liveTournamentPaymentsEnabled: false,
        cashTournamentCheckoutMode: 'test-only',
        platformRakeBps: 2000,
        premium3dPriceCents: 499,
        positionBidCents: [200, 500],
        livePositionBidsEnabled: false,
        colorBidCents: [200, 500],
        liveColorBidsEnabled: false,
      });
    }

    if (path === '/account/me') return json(route, { account: mockAccount });
    if (path === '/account/sessions') return json(route, { sessions: [] });
    if (path === '/account/blocked') return json(route, { players: [] });
    if (path === '/account/social-status') {
      return json(route, { google: false, apple: false, ordinaryAuthRequired: true });
    }

    if (path === '/fair-play/policy') {
      return json(route, {
        configured: true,
        accepted: visualState.fairPlayAccepted,
        version: 'visual-1',
        acceptedAt: visualState.fairPlayAccepted ? FIXED_NOW - 3_600_000 : null,
        rules: [
          'Play without engine or outside move assistance.',
          'Do not stall games or manipulate disconnections.',
          'Use one competitive identity and respect opponents.',
        ],
        identity: { id: mockAccount.id, displayName: mockAccount.displayName },
      });
    }

    if (path === '/payments/status') {
      return json(route, {
        ledger: true,
        competitionProvider: 'disabled',
        competitionProviderConfigured: false,
        premiumProvider: 'disabled',
        realMoneyEnabled: false,
        jurisdictionPolicyConfigured: false,
        browserAuthoritativeBalance: false,
      });
    }

    return json(route, { error: `Unmocked visual API route: ${request.method()} ${path}` }, 404);
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(width.html, JSON.stringify(width)).toBeLessThanOrEqual(width.viewport + 1);
  expect(width.body, JSON.stringify(width)).toBeLessThanOrEqual(width.viewport + 1);
}

async function snapshotPage(page: Page, name: string, fullPage = false) {
  await assertNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot(name, { fullPage });
}

async function snapshotLocator(page: Page, locator: Locator, name: string) {
  await assertNoHorizontalOverflow(page);
  await expect(locator).toBeVisible();
  await expect(locator).toHaveScreenshot(name);
}

async function openAccount(page: Page) {
  await page.locator('.nav-account-button').dispatchEvent('click');
  await expect(page.locator('.account-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visual Tester' })).toBeVisible();
}

async function openLocalBoard(page: Page) {
  await page.getByRole('button', { name: 'Same Device', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Play together.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(page.locator('.local-board-frame.match-board-frame')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  visualState.fairPlayAccepted = true;
  await seedApp(page);
  await installApi(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await page.addStyleTag({ content: `
    html { scroll-behavior: auto !important; }
    *, *::before, *::after {
      animation-delay: 0s !important;
      animation-duration: 0s !important;
      transition: none !important;
      caret-color: transparent !important;
    }
  ` });
  await expect(page.getByRole('heading', { name: 'Play chess.' })).toBeVisible();
  await expect(page.locator('.home-online-status b')).toHaveText('42 online');
});

test('header', async ({ page }) => {
  await snapshotLocator(page, page.locator('.chess-topbar'), 'header.png');
});

test('homepage', async ({ page }) => {
  await snapshotPage(page, 'homepage.png', true);
});

test('menu drawer', async ({ page }) => {
  await page.locator('.mobile-menu-button').dispatchEvent('click');
  await expect(page.locator('.chess-drawer')).toBeVisible();
  await snapshotPage(page, 'menu-drawer.png');
});

test('tournament registration', async ({ page }) => {
  await page.getByRole('button', { name: 'Play Tournament', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pick. Enter. Play.' })).toBeVisible();
  await expect(page.locator('.tournament-summary-v22')).toBeVisible();
  await snapshotPage(page, 'tournament-registration.png', true);
});

test('game board', async ({ page }) => {
  await openLocalBoard(page);
  await snapshotLocator(page, page.locator('.local-board-frame.match-board-frame'), 'game-board.png');
});

test('physical clock', async ({ page }) => {
  await openLocalBoard(page);
  await expect(page.locator('.qqurz-clock-3d-view canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(250);
  await snapshotLocator(page, page.locator('.qqurz-physical-clock-panel'), 'clock.png');
});

test('modal', async ({ page }) => {
  visualState.fairPlayAccepted = false;
  await page.getByRole('button', { name: 'Play a Friend', exact: true }).click();
  await expect(page.locator('.fair-play-modal-backdrop')).toBeVisible();
  await snapshotPage(page, 'modal.png');
});

test('account page', async ({ page }) => {
  await openAccount(page);
  await expect(page.locator('.player-rating-sheet')).toBeVisible();
  await snapshotPage(page, 'account-page.png', true);
});

test('settings screen', async ({ page }) => {
  await openAccount(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).dispatchEvent('click');
  await expect(page.getByRole('heading', { name: 'Language & timezone' })).toBeVisible();
  await snapshotPage(page, 'settings-screen.png', true);
});
