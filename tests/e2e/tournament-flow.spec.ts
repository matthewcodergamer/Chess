import { test, expect, type Page, type Route } from '@playwright/test';

const EVENT_ID = 'event_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const now = Date.now();

const summary = () => ({
  id: EVENT_ID,
  title: 'QQURZ Automated Swiss',
  format: 'swiss',
  capacity: 16,
  startTime: now + 300_000,
  roundCount: 5,
  status: phase === 'registration' ? 'registration' : 'round_active',
  currentRound: phase === 'registration' ? 0 : 1,
  registered: phase === 'registration' ? 3 : 4,
  checkedIn: phase === 'registration' ? 2 : 4,
  createdAt: now - 10_000,
  updatedAt: now,
});

let phase: 'registration' | 'game' = 'registration';

const mockAccount = {
  id: 'test',
  email: 'test@example.invalid',
  emailVerifiedAt: now,
  username: 'test-player',
  displayName: 'Test Player',
  countryCode: 'JM',
  avatar: '♞',
  avatarImage: null,
  ratingModel: 'glicko2',
  chess960Ratings: {},
  rating: 1500,
  chess960Rating: 1500,
  gamesPlayed: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  createdAt: now - 86_400_000,
  updatedAt: now,
  privacy: { profileVisibility: 'public', showCountry: true, showHistory: true, allowChallenges: true },
  notifications: { gameInvites: true, tournamentUpdates: true, results: true, productUpdates: false },
  settings: { language: 'en', timezone: 'America/Jamaica' },
  blockedPlayerIds: [],
  gameHistory: [],
  tournamentHistory: [],
  trophies: [],
  sessionCount: 1,
};

const emptySocial = {
  friends: [],
  following: [],
  incomingRequests: [],
  outgoingRequests: [],
  recentOpponents: [],
};

function detail() {
  return {
    ...summary(),
    organizerName: 'QQURZ',
    entryRules: { mode: 'open', requiresVerifiedAccount: false, minRating: null, maxRating: null, registrationClosesBeforeStartMs: 0 },
    checkInRules: { required: false, opensBeforeStartMs: 1_800_000, closesAfterStartMs: 300_000 },
    timeControl: { id: '5+0', label: '5+0', baseMs: 300_000, incrementMs: 0, custom: false },
    positionPolicy: { mode: 'fixed', positionId: 518 },
    payout: { mode: 'none', currency: 'USD', poolCents: 0, places: [] },
    tieBreakRules: ['buchholz', 'wins'],
    standings: [],
    participants: [],
    rounds: phase === 'game' ? [{ number: 1, status: 'active', positionId: 518, startedAt: now, completedAt: null, pairings: [] }] : [],
    payoutLedger: [], payoutStatus: 'not_applicable', cancellationReason: null, startedAt: phase === 'game' ? now : null, completedAt: null,
    schedule: { registrationClosesAt: now + 200_000, checkInOpensAt: now - 10_000, checkInClosesAt: now + 400_000, startDeadline: now + 300_000 },
    serverNow: now,
  };
}

function me() {
  return phase === 'game'
    ? {
        participant: { id: 'p_test', name: 'Test Player', rating: 1500, checkedInAt: now, seed: 4, status: 'active' },
        seat: { code: 'ABC123', token: 'seat-test-token', color: 'white' },
        pairing: null,
        tournament: summary(),
        serverNow: now,
      }
    : { participant: null, seat: null, pairing: null, tournament: summary(), serverNow: now };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function activate(page: Page, name: string | RegExp) {
  const button = page.getByRole('button', { name });
  if (await button.count()) {
    await button.first().dispatchEvent('click');
    return;
  }
  throw new Error(`Required control is not present: ${name}`);
}

async function installApi(page: Page) {
  await page.route('**/__qqurz_test_api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/__qqurz_test_api', '');

    if (path === '/tournament-engine/tournaments' && request.method() === 'GET') return json(route, { tournaments: [summary()], serverNow: now });
    if (path === `/tournament-engine/tournaments/${EVENT_ID}` && request.method() === 'GET') return json(route, { tournament: detail() });
    if (path === `/tournament-engine/tournaments/${EVENT_ID}/me`) return json(route, me());
    if (path === `/tournament-engine/tournaments/${EVENT_ID}/register` && request.method() === 'POST') {
      phase = 'game';
      return json(route, { tournament: detail() });
    }

    // The signed-in app mounts account, social and notification surfaces in the
    // background. Keep those payloads valid so this E2E flow tests the tournament
    // path instead of crashing on intentionally unrelated service calls.
    if (path === '/account/me') return json(route, { account: mockAccount });
    if (path === '/social/overview') return json(route, emptySocial);
    if (path === '/notifications') return json(route, { notifications: [], unread: 0, serverNow: now });
    if (path === '/notifications/push/config') return json(route, { configured: false, publicKey: null, subscriptions: 0 });
    if (path === '/presence/ping') return json(route, { onlinePlayers: 12, presence: { online: 8, away: 2, game: 2 } });
    if (path === '/payments/status') return json(route, { ledger: true, competitionProvider: 'disabled', competitionProviderConfigured: false, premiumProvider: 'disabled', realMoneyEnabled: false, jurisdictionPolicyConfigured: false, browserAuthoritativeBalance: false });

    // Never return a successful but malformed payload for APIs that this flow does not
    // exercise. Background surfaces should treat an unmocked route as unavailable.
    return json(route, { error: `Unmocked E2E API route: ${request.method()} ${path}` }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  phase = 'registration';
  await page.addInitScript(() => {
    localStorage.setItem('qqurz:onboarding-v1', JSON.stringify({
      version: 1, completedAt: Date.now(), experience: 'tournament', boardAppearance: 'tournament', soundEnabled: false, accountCreated: true,
    }));
    localStorage.setItem('qqurz:account-token', 'e2e-account-token');
    localStorage.setItem('qqurz:profile', JSON.stringify({ username: 'Test Player', avatar: '♞' }));
  });
  await installApi(page);
});

test('Home → Tournament → Register → assigned game launch', async ({ page }) => {
  await page.goto('/');
  await activate(page, /^(Open tournaments|Tournaments|Play a tournament)$/);
  await expect(page.getByRole('heading', { name: 'QQURZ Automated Swiss' })).toBeVisible();

  const register = page.getByRole('button', { name: 'Register', exact: true });
  await expect(register).toBeEnabled();
  await register.click();

  const openGame = page.getByRole('button', { name: 'Open game', exact: true });
  await expect(openGame).toBeVisible();
  await openGame.dispatchEvent('click');

  await expect(page.getByText(/Tournament · ABC123/)).toBeVisible();
  await expect(page).toHaveURL(/room=ABC123/);
});
