import { expect, test, type Page, type Route } from '@playwright/test';

const FIXED_NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const EVENT_ID = 'event_visual_qqurz_960';

const ratingState = (rating: number, games: number, wins: number, draws: number, losses: number) => ({
  rating,
  deviation: games ? 62 : 350,
  volatility: 0.06,
  games,
  wins,
  draws,
  losses,
  provisional: games < 10,
  lastRatedAt: games ? FIXED_NOW - 86_400_000 : null,
});

const mockAccount = {
  id: 'visual-player',
  email: 'visual@example.invalid',
  emailVerifiedAt: FIXED_NOW - 604_800_000,
  username: 'visual-player',
  displayName: 'Visual Player',
  countryCode: 'JM',
  avatar: '♞',
  avatarImage: null,
  ratingModel: 'glicko2',
  chess960Ratings: {
    rapid: ratingState(1684, 24, 14, 4, 6),
    blitz: ratingState(1592, 13, 7, 2, 4),
    bullet: ratingState(1500, 0, 0, 0, 0),
  },
  rating: 1684,
  chess960Rating: 1684,
  gamesPlayed: 37,
  wins: 21,
  draws: 6,
  losses: 10,
  createdAt: FIXED_NOW - 90 * 86_400_000,
  updatedAt: FIXED_NOW - 3_600_000,
  privacy: { profileVisibility: 'public', showCountry: true, showHistory: true, allowChallenges: true },
  notifications: { gameInvites: true, tournamentUpdates: true, results: true, productUpdates: false },
  settings: { language: 'en', timezone: 'America/Jamaica' },
  blockedPlayerIds: [],
  gameHistory: [],
  tournamentHistory: [],
  trophies: [],
  sessionCount: 1,
};

const tournamentSummary = {
  id: EVENT_ID,
  title: 'QQURZ Visual Swiss',
  format: 'swiss',
  capacity: 64,
  startTime: FIXED_NOW + 3_600_000,
  roundCount: 6,
  status: 'registration',
  currentRound: 0,
  registered: 37,
  checkedIn: 0,
  createdAt: FIXED_NOW - 86_400_000,
  updatedAt: FIXED_NOW,
};

const tournamentDetail = {
  ...tournamentSummary,
  organizerName: 'QQURZ',
  entryRules: {
    mode: 'open',
    requiresVerifiedAccount: true,
    minRating: null,
    maxRating: null,
    registrationClosesBeforeStartMs: 300_000,
  },
  checkInRules: { required: true, opensBeforeStartMs: 1_800_000, closesAfterStartMs: 300_000 },
  timeControl: { id: '10+5', label: '10+5', baseMs: 600_000, incrementMs: 5_000, custom: false },
  positionPolicy: { mode: 'per_game' },
  payout: { mode: 'none', currency: 'USD', poolCents: 0, places: [] },
  tieBreakRules: ['buchholz', 'wins'],
  standings: [],
  participants: [],
  rounds: [],
  payoutLedger: [],
  payoutStatus: 'not_applicable',
  cancellationReason: null,
  startedAt: null,
  completedAt: null,
  schedule: {
    registrationClosesAt: FIXED_NOW + 3_300_000,
    checkInOpensAt: FIXED_NOW + 1_800_000,
    checkInClosesAt: FIXED_NOW + 3_900_000,
    startDeadline: FIXED_NOW + 4_200_000,
  },
  serverNow: FIXED_NOW,
};

const tournamentMe = {
  participant: null,
  seat: null,
  pairing: null,
  tournament: tournamentSummary,
  serverNow: FIXED_NOW,
};

const emptySocial = {
  friends: [],
  following: [],
  incomingRequests: [],
  outgoingRequests: [],
  recentOpponents: [],
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installApi(page: Page) {
  await page.route('**/__qqurz_test_api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/__qqurz_test_api', '');

    if (path === '/presence/ping') return json(route, { onlinePlayers: 12, presence: { online: 8, away: 2, game: 2 } });
    if (path === '/account/me') return json(route, { account: mockAccount });
    if (path === '/account/sessions') return json(route, { sessions: [{ id: 'visual-session', createdAt: FIXED_NOW - 86_400_000, lastSeenAt: FIXED_NOW, expiresAt: FIXED_NOW + 2_592_000_000, deviceName: 'Visual test browser', userAgent: 'QQURZ visual regression', ipPrefix: '127.0.0.*', current: true }] });
    if (path === '/account/blocked') return json(route, { players: [] });
    if (path === '/account/social-status') return json(route, { google: false, apple: false, ordinaryAuthRequired: true });
    if (path === '/social/overview') return json(route, emptySocial);
    if (path === '/notifications') return json(route, { notifications: [], unread: 0, serverNow: FIXED_NOW });
    if (path === '/notifications/push/config') return json(route, { configured: false, publicKey: null, subscriptions: 0 });
    if (path === '/payments/status') return json(route, { ledger: true, competitionProvider: 'disabled', competitionProviderConfigured: false, premiumProvider: 'disabled', realMoneyEnabled: false, jurisdictionPolicyConfigured: false, browserAuthoritativeBalance: false });

    if (path === '/tournament-engine/tournaments' && request.method() === 'GET') return json(route, { tournaments: [tournamentSummary], serverNow: FIXED_NOW });
    if (path === `/tournament-engine/tournaments/${EVENT_ID}` && request.method() === 'GET') return json(route, { tournament: tournamentDetail });
    if (path === `/tournament-engine/tournaments/${EVENT_ID}/me` && request.method() === 'GET') return json(route, tournamentMe);

    return json(route, { error: `Unmocked visual API route: ${request.method()} ${path}` }, 404);
  });
}

async function seedApp(page: Page) {
  await page.addInitScript(({ fixedNow }) => {
    localStorage.setItem('qqurz:onboarding-v1', JSON.stringify({
      version: 1,
      completedAt: fixedNow,
      experience: 'tournament',
      boardAppearance: 'tournament',
      soundEnabled: false,
      accountCreated: true,
    }));
    localStorage.setItem('qqurz:account-token', 'visual-account-token');
    localStorage.setItem('qqurz:profile', JSON.stringify({ username: 'Visual Player', avatar: '♞', createdAt: fixedNow }));
    localStorage.setItem('qqurz:theme', 'dark');
    localStorage.setItem('qqurz:font-scale', 'default');
    localStorage.setItem('qqurz:quick-time', '3+2');
  }, { fixedNow: FIXED_NOW });

  // Local-game Chess960 selection uses Web Crypto. Force only its single Uint32
  // draw to position 518 so board screenshots are identical on every run.
  await page.addInitScript(`(() => {
    const original = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, 'getRandomValues', {
      configurable: true,
      value(array) {
        if (array instanceof Uint32Array && array.length === 1) {
          array[0] = 518;
          return array;
        }
        return original(array);
      },
    });
  })();`);
}

async function stabilize(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      scroll-behavior: auto !important;
      caret-color: transparent !important;
    }
  ` });
  await page.waitForTimeout(50);
}

async function expectNoDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(() => Math.ceil(document.documentElement.scrollWidth - document.documentElement.clientWidth));
  expect(overflow, 'document must not overflow the canonical viewport horizontally').toBeLessThanOrEqual(1);
}

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Play chess.' })).toBeVisible();
  await stabilize(page);
}

async function openDrawer(page: Page) {
  await page.locator('.mobile-menu-button').dispatchEvent('click');
  await expect(page.getByRole('dialog', { name: 'QQURZ menu' })).toBeVisible();
  await stabilize(page);
}

async function openLocalStrategy(page: Page) {
  await openHome(page);
  await openDrawer(page);
  await page.getByRole('dialog', { name: 'QQURZ menu' }).getByRole('button', { name: /Same device/i }).dispatchEvent('click');
  await expect(page.getByRole('heading', { name: 'Play together.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(page.locator('.local-board-frame')).toBeVisible();
  await expect(page.locator('.local-board-overlay')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await stabilize(page);
}

async function openAccount(page: Page) {
  await openHome(page);
  await page.getByRole('button', { name: 'Open Visual Player profile' }).click();
  await expect(page.getByRole('navigation', { name: 'Account sections' })).toBeVisible();
  await stabilize(page);
}

async function openDisplaySettings(page: Page) {
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) > 720) {
    await page.locator('.display-toggle').click();
  } else {
    await openDrawer(page);
    await page.getByRole('dialog', { name: 'QQURZ menu' }).locator('.drawer-settings button').last().click();
  }
  await expect(page.locator('#qqurz-display-menu')).toBeVisible();
  await stabilize(page);
}

test.beforeEach(async ({ page }) => {
  await seedApp(page);
  await installApi(page);
});

test('header', async ({ page }) => {
  await openHome(page);
  await expectNoDocumentOverflow(page);
  await expect(page.locator('.chess-topbar')).toHaveScreenshot('header.png');
});

test('homepage', async ({ page }) => {
  await openHome(page);
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('homepage.png', { fullPage: true });
});

test('menu drawer', async ({ page }) => {
  await openHome(page);
  await openDrawer(page);
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('menu-drawer.png');
});

test('tournament registration', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: /Play Tournament/i }).click();
  await expect(page.getByRole('heading', { name: 'QQURZ Visual Swiss' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register', exact: true })).toBeEnabled();
  await stabilize(page);
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('tournament-registration.png', { fullPage: true });
});

test('game board', async ({ page }) => {
  await openLocalStrategy(page);
  await page.locator('.local-board-overlay').getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.local-board-overlay')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await stabilize(page);
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('game-board.png');
});

test('clock', async ({ page }) => {
  await openLocalStrategy(page);
  const playerBar = page.locator('.match-player-bar.self');
  await playerBar.evaluate(element => element.classList.add('active'));
  await expect(playerBar.locator('.match-player-time')).toContainText('10:00');
  await expect(playerBar).toHaveScreenshot('clock.png');
});

test('modal overlay', async ({ page }) => {
  await openLocalStrategy(page);
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('modal.png', {
    mask: [page.locator('.local-board-overlay > strong')],
    maskColor: '#191816',
  });
});

test('account page', async ({ page }) => {
  await openAccount(page);
  await expect(page.getByRole('heading', { name: 'Competitive identity' })).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('account-page.png', { fullPage: true });
});

test('account settings', async ({ page }) => {
  await openAccount(page);
  await page.getByRole('navigation', { name: 'Account sections' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Language & timezone' })).toBeVisible();
  await stabilize(page);
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('account-settings.png', { fullPage: true });
});

test('display settings', async ({ page }) => {
  await openHome(page);
  await openDisplaySettings(page);
  await expectNoDocumentOverflow(page);
  await expect(page).toHaveScreenshot('display-settings.png');
});
