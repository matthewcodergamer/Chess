import { expect, test, type Page, type Route } from '@playwright/test';

const PORTRAIT_SAFE_AREA = { top: 47, right: 0, bottom: 34, left: 0 };
const LANDSCAPE_SAFE_AREA = { top: 0, right: 47, bottom: 21, left: 47 };

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function seedApp(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('qqurz:onboarding-v1', JSON.stringify({ version: 1, completedAt: Date.now(), experience: 'tournament', boardAppearance: 'tournament', soundEnabled: false, accountCreated: true }));
    localStorage.setItem('qqurz:board-appearance', 'tournament');
    localStorage.setItem('qqurz:theme', 'dark');
    localStorage.setItem('qqurz:font-scale', 'default');
    localStorage.setItem('qqurz:account-token', 'mobile-overlap-audit-token');
    localStorage.setItem('qqurz:presence-id', 'mobile-overlap-audit-presence');
    localStorage.setItem('qqurz:profile', JSON.stringify({ username: 'Mobile Audit', avatar: '♞' }));
  });
}

async function installApi(page: Page) {
  await page.route('**/__qqurz_test_api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__qqurz_test_api', '');
    if (path === '/presence/ping') return json(route, { onlinePlayers: 42, presence: { online: 34, away: 5, game: 3 } });
    if (path === '/tournaments' || path === '/tournament-engine/tournaments') return json(route, { tournaments: [], serverNow: Date.now(), paymentMode: 'off', paymentConfigured: false, liveTournamentPaymentsEnabled: false, cashTournamentCheckoutMode: 'test-only', platformRakeBps: 0, premium3dPriceCents: 499, positionBidCents: [200, 500], livePositionBidsEnabled: false, colorBidCents: [200, 500], liveColorBidsEnabled: false });
    if (path === '/fair-play/policy') return json(route, { configured: true, accepted: true, version: 'mobile-overlap-audit-3', acceptedAt: Date.now(), rules: [], identity: { id: 'mobile-audit-player', displayName: 'Mobile Audit' } });
    if (path === '/payments/status') return json(route, { ledger: true, competitionProvider: 'disabled', competitionProviderConfigured: false, premiumProvider: 'disabled', premiumProviderConfigured: false, realMoneyEnabled: false, jurisdictionPolicyConfigured: false, browserAuthoritativeBalance: false });
    if (path === '/payments/wallet') return json(route, { wallet: { accountId: 'mobile-audit-player', currency: 'USD', availableCents: 0, heldCents: 0, pendingWithdrawalCents: 0, debtCents: 0, updatedAt: Date.now(), sequence: 1 }, compliance: null, capabilities: { deposit: { allowed: false }, friendMatch: { allowed: false }, tournament: { allowed: false }, withdrawal: { allowed: false } }, entitlements: { premium3d: false, updatedAt: Date.now() } });
    return json(route, { error: `Unmocked mobile-overlap route: ${route.request().method()} ${path}` }, 404);
  });
}

async function gotoAudit(page: Page, url = '/', insets = PORTRAIT_SAFE_AREA) {
  await page.goto(url);
  await page.addStyleTag({ content: `:root[data-release-overlap-audit='on']{--release-safe-top:${insets.top}px;--release-safe-right:${insets.right}px;--release-safe-bottom:${insets.bottom}px;--release-safe-left:${insets.left}px;--q-header-h:calc(70px + var(--release-safe-top))}@media(max-width:900px){:root[data-release-overlap-audit='on'] .qqurz-main-content{box-sizing:border-box!important;padding-left:var(--release-safe-left)!important;padding-right:var(--release-safe-right)!important}:root[data-release-overlap-audit='on'] .chess-topbar{box-sizing:border-box!important;height:var(--q-header-h)!important;padding-top:var(--release-safe-top)!important;padding-right:max(12px,var(--release-safe-right))!important;padding-left:max(12px,var(--release-safe-left))!important}}` });
  await page.evaluate(() => { document.documentElement.dataset.releaseOverlapAudit = 'on'; });
}

async function expectMobileSafe(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.html).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.beforeEach(async ({ page }) => {
  await seedApp(page);
  await installApi(page);
});

test('mobile home remains contained at Safari viewport heights', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await gotoAudit(page);
  await expect(page.getByRole('heading', { name: 'Play chess.' })).toBeVisible();
  await expectMobileSafe(page);
  await page.setViewportSize({ width: 390, height: 664 });
  await expectMobileSafe(page);
});

test('mobile navigation drawer remains contained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await gotoAudit(page);
  await page.locator('.mobile-menu-button').click();
  await expect(page.locator('.chess-drawer')).toBeVisible();
  await expectMobileSafe(page);
});

test('virtual keyboard compression keeps the room-code input reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await gotoAudit(page);
  await page.getByRole('button', { name: 'Play vs Friend', exact: true }).click();
  await expect(page.locator('.online-lobby-panel')).toBeVisible();
  const input = page.getByPlaceholder('ROOM CODE');
  await input.focus();
  await page.setViewportSize({ width: 390, height: 360 });
  await input.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await expect(input).toBeFocused();
  await expectMobileSafe(page);
});

test('landscape local board respects side safe areas', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await gotoAudit(page, '/', LANDSCAPE_SAFE_AREA);
  await page.getByRole('button', { name: 'Same device', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Play together.' })).toBeVisible();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(page.locator('.local-board-frame.match-board-frame')).toBeVisible();
  await expectMobileSafe(page);
});

test('checkout return route remains mobile-safe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await gotoAudit(page, '/?checkout=success&kind=premium3d&session_id=audit-premium');
  await expect(page.locator('main')).toBeVisible();
  await expectMobileSafe(page);
});

test('runtime rotation preserves containment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await gotoAudit(page);
  await expectMobileSafe(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await expectMobileSafe(page);
  await page.setViewportSize({ width: 390, height: 664 });
  await expectMobileSafe(page);
});

test('home has no physical clock overlay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await gotoAudit(page);
  await expect(page.locator('.qqurz-physical-clock-panel')).toHaveCount(0);
  await expectMobileSafe(page);
});
