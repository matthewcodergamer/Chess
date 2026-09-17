import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const FIXED_NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const EVENT_ID = 'event_visual_regression_960';
const visualState = { fairPlayAccepted: true };

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
  title: 'QQURZ Sunday Chess960 Open',
  format: 'swiss',
  capacity: 64,
  startTime: FIXED_NOW + 3_600_000,
  roundCount: 6,
  status: 'registration',
  currentRound: 0,
  registered: 38,
  checkedIn: 0,
  createdAt: FIXED_NOW - 86_400_000,
  updatedAt: FIXED_NOW,
  entryFeeCents: 0,
  moneyStatus: 'registration',
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
  positionPolicy: { mode: 'per_round' },
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
    startDeadline: FIXED_NOW + 3_600_000,
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

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function seedApp(page: Page) {
  await page.addInitScript(({ now }) => {
    // Keep time-dependent UI deterministic for canonical visual snapshots.
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length ? args : [now]));
      }

      static now() {
        return now;
      }
    }
    window.Date = FixedDate as DateConstructor;

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
      // Web Crypto is patchable in Chromium CI; if a browser locks it down the
      // board remains valid, while the rest of the visual fixture stays fixed.
    }
  }, { now: FIXED_NOW });
}

async function installApi(page: Page) {
  await page.route('**/__qqurz_test_api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/__qqurz_test_api', '');

    if (path === '/presence/ping') {
      return json(route, { onlinePlayers: 42, presence: { online: 34, away: 5, game: 3 } });
    }

    if (path === '/tournament-engine/tournaments' && request.method() === 'GET') {
      return json(route, { tournaments: [tournamentSummary], serverNow: FIXED_NOW });
    }
    if (path === `/tournament-engine/tournaments/${EVENT_ID}` && request.method() === 'GET') {
      return json(route, { tournament: tournamentDetail });
    }
    if (path === `/tournament-engine/tournaments/${EVENT_ID}/me`) return json(route, tournamentMe);

    // Legacy/test catalog requests can happen in the background even though the
    // canonical registration screenshot uses the server-authoritative master grid.
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
  // At the narrowest mobile breakpoint the identity heading can be intentionally
  // collapsed by responsive CSS. Readiness is based on the loaded account shell,
  // while the screenshot itself is what guards that responsive presentation.
  await expect(page.locator('.account-tabs')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeAttached();
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
  await expect(page.getByRole('heading', { name: 'Find a tournament and get in.' })).toBeVisible();
  await expect(page.locator('.tournament-master-grid')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QQURZ Sunday Chess960 Open' })).toBeVisible();
  await snapshotPage(page, 'tournament-registration.png', true);
});

test('game board', async ({ page }) => {
  await openLocalBoard(page);
  const board = page.locator('.local-board-frame.match-board-frame');
  await expect(board).toBeVisible();
  // The pre-game clock can cross a one-second boundary while the board screenshot
  // is captured; tolerate only the measured digit-level drift (662 pixels).
  await expect(board).toHaveScreenshot('game-board.png', { maxDiffPixels: 700 });
});

test('digital chess clock', async ({ page }) => {
  await openLocalBoard(page);
  const clocks = page.locator('.match-player-bar');
  await expect(clocks).toHaveCount(2);
  await expect(clocks.first()).toBeVisible();
  await expect(clocks.last()).toBeVisible();
  await expect(page.locator('.qqurz-clock-3d-view canvas')).toHaveCount(0);
});

test('modal', async ({ page }) => {
  visualState.fairPlayAccepted = false;
  await page.getByRole('button', { name: 'Play a Friend', exact: true }).click();
  await expect(page.locator('.fair-play-modal-backdrop')).toBeVisible();
  await snapshotPage(page, 'modal.png');
});

test('account page', async ({ page }) => {
  await openAccount(page);
  await expect(page.locator('.player-rating-sheet')).toBeAttached();
  await snapshotPage(page, 'account-page.png', true);
});

test('settings screen', async ({ page }) => {
  await openAccount(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).dispatchEvent('click');
  await expect(page.getByRole('heading', { name: 'Language & timezone' })).toBeAttached();
  await snapshotPage(page, 'settings-screen.png', true);
});
