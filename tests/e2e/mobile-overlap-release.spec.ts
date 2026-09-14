import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const FIXED_NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const ROOM_CODE = 'AUDIT1';
const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PROMOTION_FEN = '7k/P7/8/8/8/8/8/K7 w - - 0 1';
const auditState = { fairPlayAccepted: true };

type SessionState = 'COIN_TOSS' | 'ACTIVE' | 'RECONNECTING';
type SafeArea = { top: number; right: number; bottom: number; left: number };

const PORTRAIT_SAFE_AREA: SafeArea = { top: 47, right: 0, bottom: 34, left: 0 };
const LANDSCAPE_SAFE_AREA: SafeArea = { top: 0, right: 47, bottom: 21, left: 47 };

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function seedApp(page: Page, withRoomSeat = false) {
  await page.addInitScript(({ now, roomCode, seat }) => {
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
    localStorage.setItem('qqurz:font-scale', 'extra');
    localStorage.setItem('qqurz:clock-visible', 'true');
    localStorage.setItem('qqurz:account-token', 'mobile-overlap-audit-token');
    localStorage.setItem('qqurz:presence-id', 'mobile-overlap-audit-presence');
    localStorage.setItem('qqurz:profile', JSON.stringify({ username: 'Mobile Audit', avatar: '♞' }));
    if (seat) {
      sessionStorage.setItem(`qqurz:room-seat:${roomCode}`, JSON.stringify({
        code: roomCode,
        token: 'mobile-overlap-seat-token',
        color: 'white',
      }));
    }
  }, { now: FIXED_NOW, roomCode: ROOM_CODE, seat: withRoomSeat });
}

async function installApi(page: Page) {
  await page.route('**/__qqurz_test_api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/__qqurz_test_api', '');

    if (path === '/presence/ping') {
      return json(route, { onlinePlayers: 42, presence: { online: 34, away: 5, game: 3 } });
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
    if (path === '/tournament-engine/tournaments') {
      return json(route, { tournaments: [], serverNow: FIXED_NOW });
    }
    if (path === '/fair-play/policy') {
      return json(route, {
        configured: true,
        accepted: auditState.fairPlayAccepted,
        version: 'mobile-overlap-audit-1',
        acceptedAt: auditState.fairPlayAccepted ? FIXED_NOW - 60_000 : null,
        rules: [
          'Play without engine or outside move assistance.',
          'Do not stall games or manipulate disconnections.',
          'Use one competitive identity and respect opponents.',
        ],
        identity: { id: 'mobile-audit-player', displayName: 'Mobile Audit' },
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
    if (path === '/payments/wallet') {
      const denied = { allowed: false, jurisdiction: 'test', reason: 'Release overlap audit fixture.' };
      return json(route, {
        wallet: {
          accountId: 'mobile-audit-player', currency: 'USD', availableCents: 0,
          heldCents: 0, pendingWithdrawalCents: 0, debtCents: 0,
          updatedAt: FIXED_NOW, sequence: 1,
        },
        compliance: null,
        capabilities: { deposit: denied, friendMatch: denied, tournament: denied, withdrawal: denied },
        entitlements: { premium3d: false, updatedAt: FIXED_NOW },
      });
    }

    return json(route, { error: `Unmocked mobile-overlap route: ${request.method()} ${path}` }, 404);
  });
}

function sessionFixture(state: SessionState, fen: string) {
  const startedAt = state === 'ACTIVE' || state === 'RECONNECTING' ? Date.now() : null;
  return {
    id: `mobile-overlap-${state.toLowerCase()}`,
    state,
    positionId: 518,
    fen,
    sideToMove: 'white',
    clocks: {
      whiteMs: 600_000,
      blackMs: 600_000,
      baseMs: 600_000,
      incrementMs: 5_000,
      startedAt,
    },
    pendingClockPress: null,
    countdownMs: 0,
    countdownEndsAt: null,
    moveNumber: 0,
    movesSan: [],
    drawOffers: { white: false, black: false },
    resignedBy: null,
    connection: {
      status: state === 'RECONNECTING' ? 'RECONNECTING' : 'CONNECTED',
      white: true,
      black: state !== 'RECONNECTING',
    },
    result: null,
    resultKind: null,
    winner: null,
    check: false,
    checkmate: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    finalizedAt: null,
  };
}

function roomFixture(state: SessionState, fen: string, coinResult: 'heads' | 'tails' | null = null) {
  const now = Date.now();
  return {
    code: ROOM_CODE,
    session: sessionFixture(state, fen),
    status: state === 'COIN_TOSS' ? 'coin' : 'playing',
    positionId: 518,
    fen,
    turn: 'white',
    activeClock: state === 'ACTIVE' || state === 'RECONNECTING' ? 'white' : null,
    awaitingClockPress: null,
    whiteClockMs: 600_000,
    blackClockMs: 600_000,
    turnStartedAt: state === 'ACTIVE' || state === 'RECONNECTING' ? now : null,
    strategyEndsAt: null,
    serverNow: now,
    lastMoveTiming: null,
    moves: [],
    result: null,
    check: false,
    checkmate: false,
    yourColor: 'white',
    players: {
      white: { name: 'Mobile Audit', connected: true, rating: 1600 },
      black: { name: 'Opponent', connected: state !== 'RECONNECTING', rating: 1600 },
    },
    spectator: false,
    tournamentId: null,
    permissions: { readOnly: false, analysis: false },
    coin: {
      claimedFace: coinResult,
      claimedBy: coinResult ? 'Mobile Audit' : null,
      result: coinResult,
      winner: coinResult ? 'Mobile Audit' : null,
      flippedAt: coinResult ? now : null,
      endsAt: null,
      yourFace: coinResult,
    },
    auction: { leadingBidCents: 0, leaderName: null, rerollCount: 0, yourBidCents: 0 },
    colorAuction: {
      leadingBidCents: 0,
      leaderName: null,
      desiredColor: null,
      yourBidCents: 0,
      yourDesiredColor: null,
      yourBidRefunded: false,
    },
  };
}

async function installRoomSocket(page: Page, state: SessionState, fen = STANDARD_FEN, coinResult: 'heads' | 'tails' | null = null) {
  const room = roomFixture(state, fen, coinResult);
  await page.routeWebSocket('**/__qqurz_test_api/rooms/**/ws*', ws => {
    ws.onMessage(message => {
      let payload: { type?: string } = {};
      try { payload = JSON.parse(String(message)) as { type?: string }; } catch { /* ignored */ }
      if (payload.type !== 'sync_request') return;
      ws.send(JSON.stringify({ type: 'color_gate', enabled: false, open: true, yourOptOut: false, optedOut: 0, required: 2 }));
      ws.send(JSON.stringify({ type: 'snapshot', room }));
    });
  });
}

async function installSafeAreaHarness(page: Page, insets: SafeArea) {
  await page.addStyleTag({ content: `
    :root[data-release-overlap-audit='on'] {
      --release-safe-top: 0px;
      --release-safe-right: 0px;
      --release-safe-bottom: 0px;
      --release-safe-left: 0px;
    }
    @media (max-width: 900px) {
      :root[data-release-overlap-audit='on'] .chess-topbar {
        box-sizing: border-box !important;
        height: calc(70px + var(--release-safe-top)) !important;
        padding-top: var(--release-safe-top) !important;
        padding-right: max(12px, var(--release-safe-right)) !important;
        padding-left: max(12px, var(--release-safe-left)) !important;
      }
      :root[data-release-overlap-audit='on'] .chess-drawer {
        padding-top: max(16px, var(--release-safe-top)) !important;
        padding-right: max(16px, var(--release-safe-right)) !important;
        padding-bottom: calc(24px + var(--release-safe-bottom)) !important;
        padding-left: max(16px, var(--release-safe-left)) !important;
      }
      :root[data-release-overlap-audit='on'] .modal-backdrop,
      :root[data-release-overlap-audit='on'] .fair-play-modal-backdrop,
      :root[data-release-overlap-audit='on'] .online-promotion {
        box-sizing: border-box !important;
        padding-top: max(12px, var(--release-safe-top)) !important;
        padding-right: max(12px, var(--release-safe-right)) !important;
        padding-bottom: max(12px, var(--release-safe-bottom)) !important;
        padding-left: max(12px, var(--release-safe-left)) !important;
      }
      :root[data-release-overlap-audit='on'] .display-popover {
        left: max(12px, var(--release-safe-left)) !important;
        right: max(12px, var(--release-safe-right)) !important;
        max-height: calc(100dvh - 86px - var(--release-safe-top) - var(--release-safe-bottom)) !important;
      }
    }
  ` });
  await page.evaluate(value => {
    const root = document.documentElement;
    root.dataset.releaseOverlapAudit = 'on';
    root.style.setProperty('--release-safe-top', `${value.top}px`);
    root.style.setProperty('--release-safe-right', `${value.right}px`);
    root.style.setProperty('--release-safe-bottom', `${value.bottom}px`);
    root.style.setProperty('--release-safe-left', `${value.left}px`);
  }, insets);
}

async function setSafeArea(page: Page, insets: SafeArea) {
  await page.evaluate(value => {
    const root = document.documentElement;
    root.style.setProperty('--release-safe-top', `${value.top}px`);
    root.style.setProperty('--release-safe-right', `${value.right}px`);
    root.style.setProperty('--release-safe-bottom', `${value.bottom}px`);
    root.style.setProperty('--release-safe-left', `${value.left}px`);
  }, insets);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.html, `${label}: html overflow ${JSON.stringify(widths)}`).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body, `${label}: body overflow ${JSON.stringify(widths)}`).toBeLessThanOrEqual(widths.viewport + 1);
}

async function expectNoCoveredControls(page: Page, label: string) {
  const issues = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const visible = (element: Element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width;
    };

    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible);
    const drawer = [...document.querySelectorAll<HTMLElement>('.chess-drawer')].filter(visible).at(-1) ?? null;
    const scope = dialogs.at(-1) ?? drawer ?? document.querySelector<HTMLElement>('.qqurz-main-content') ?? document.body;
    const problems: string[] = [];

    const controls = [...scope.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [role="button"], [tabindex]:not([tabindex="-1"])')].filter(visible);
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      const x = Math.min(viewport.width - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(viewport.height - 1, Math.max(0, rect.top + rect.height / 2));
      if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) continue;
      const top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (!control.contains(top) && !top.contains(control)) {
        problems.push(`${control.tagName.toLowerCase()}.${control.className || '(no-class)'} covered by ${top.tagName.toLowerCase()}.${(top as HTMLElement).className || '(no-class)'}`);
      }
    }

    const fixed = [...document.querySelectorAll<HTMLElement>('body *')].filter(element => {
      if (!visible(element)) return false;
      const position = getComputedStyle(element).position;
      return position === 'fixed' || position === 'sticky';
    });
    for (const element of fixed) {
      const rect = element.getBoundingClientRect();
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewport.width || rect.top >= viewport.height) continue;
      if (rect.left < -2 || rect.right > viewport.width + 2) {
        problems.push(`fixed/sticky ${element.tagName.toLowerCase()}.${element.className || '(no-class)'} escapes viewport horizontally: ${Math.round(rect.left)}..${Math.round(rect.right)} / ${viewport.width}`);
      }
    }

    return problems;
  });
  expect(issues, `${label}: fixed controls or overlays cover active content`).toEqual([]);
}

async function auditViewport(page: Page, label: string, includeBottomEdge = false) {
  await expectNoHorizontalOverflow(page, label);
  await expectNoCoveredControls(page, label);
  if (!includeBottomEdge) return;

  const startY = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(50);
  await expectNoHorizontalOverflow(page, `${label} at document bottom`);
  await expectNoCoveredControls(page, `${label} at document bottom`);
  await page.evaluate(y => window.scrollTo(0, y), startY);
}

async function gotoAudit(page: Page, url = '/', insets = PORTRAIT_SAFE_AREA) {
  await page.goto(url);
  await installSafeAreaHarness(page, insets);
}

async function openLocalBoard(page: Page) {
  await page.getByRole('button', { name: 'Same Device', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Play together.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(page.locator('.local-board-frame.match-board-frame')).toBeVisible();
}

async function openOnlineRoom(page: Page, state: SessionState, fen = STANDARD_FEN, coinResult: 'heads' | 'tails' | null = null) {
  await installRoomSocket(page, state, fen, coinResult);
  await gotoAudit(page, `/?room=${ROOM_CODE}`);
  await expect(page.locator('.online-board-frame')).toBeVisible({ timeout: 15_000 });
}

async function tapBoardSquare(page: Page, file: number, rank: number) {
  const board = page.locator('.online-board-frame cg-board');
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  if (!box) throw new Error('Online board did not have a measurable bounding box.');
  const square = box.width / 8;
  const x = square * (file + 0.5);
  const y = square * (8 - rank + 0.5);
  await board.click({ position: { x, y } });
}

test.beforeEach(async ({ page }) => {
  auditState.fairPlayAccepted = true;
  await seedApp(page, true);
  await installApi(page);
});

test('production mobile CSS carries all four iOS safe-area inset guards', async () => {
  const css = `${await readFile('src/styles/navigation.css', 'utf8')}\n${await readFile('src/styles/responsive.css', 'utf8')}`;
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    expect(css, `Missing safe-area-inset-${edge} in production responsive CSS`).toContain(`safe-area-inset-${edge}`);
  }
});

test('Safari expanded/collapsed address-bar heights, safe areas, extra-large text and drawer have no overlap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await gotoAudit(page);
  await expect(page.getByRole('heading', { name: 'Play chess.' })).toBeVisible();
  await auditViewport(page, 'Safari address bars expanded + extra-large text', true);

  await page.setViewportSize({ width: 390, height: 664 });
  await auditViewport(page, 'Safari address bars collapsed + extra-large text', true);

  await page.locator('.mobile-menu-button').click();
  await expect(page.locator('.chess-drawer')).toBeVisible();
  await auditViewport(page, 'mobile drawer with safe-area insets');
});

test('virtual keyboard compression keeps the focused online input reachable', async ({ page }) => {
  await gotoAudit(page);
  await page.getByRole('button', { name: 'Play a Friend', exact: true }).click();
  await expect(page.locator('.online-lobby-panel')).toBeVisible();

  const input = page.getByPlaceholder('ROOM CODE');
  await input.focus();
  await page.setViewportSize({ width: 390, height: 360 });
  await input.scrollIntoViewIfNeeded();
  await expect(input).toBeFocused();
  await auditViewport(page, 'virtual keyboard open with focused room-code input');

  const box = await input.boundingBox();
  expect(box, 'focused input must remain measurable above the simulated keyboard').not.toBeNull();
  expect(box!.bottom, 'focused input must remain inside the shrunken visual viewport').toBeLessThanOrEqual(360);
});

test('open modal remains contained at the smallest Safari height', async ({ page }) => {
  auditState.fairPlayAccepted = false;
  await page.setViewportSize({ width: 390, height: 568 });
  await gotoAudit(page);
  await page.getByRole('button', { name: 'Play a Friend', exact: true }).click();
  await expect(page.locator('.fair-play-modal-backdrop')).toBeVisible();
  await auditViewport(page, 'fair-play modal open');
});

test('landscape game board and physical clock survive side safe areas without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await gotoAudit(page, '/', LANDSCAPE_SAFE_AREA);
  await openLocalBoard(page);
  await auditViewport(page, 'landscape local game board with notch-side safe areas', true);

  const clock = page.locator('.qqurz-physical-clock-panel');
  await clock.scrollIntoViewIfNeeded();
  await expect(clock).toBeVisible();
  await expect(page.locator('.qqurz-clock-3d-view canvas')).toBeVisible({ timeout: 15_000 });
  await auditViewport(page, 'landscape physical clock with notch-side safe areas');
});

test('online promotion dialog stays usable with extra-large text', async ({ page }) => {
  await openOnlineRoom(page, 'ACTIVE', PROMOTION_FEN);
  await tapBoardSquare(page, 0, 7);
  await tapBoardSquare(page, 0, 8);
  await expect(page.getByRole('dialog', { name: 'Choose online promotion piece' })).toBeVisible({ timeout: 10_000 });
  await auditViewport(page, 'online promotion dialog');
});

test('real quarter flip overlay never widens or covers its controls', async ({ page }) => {
  await openOnlineRoom(page, 'COIN_TOSS', STANDARD_FEN, 'heads');
  await expect(page.locator('.coin-overlay')).toBeVisible();
  await expect(page.locator('.qqurz-quarter-3d')).toBeVisible({ timeout: 15_000 });
  await auditViewport(page, '3D U.S. quarter flip overlay during result animation');
  await page.waitForTimeout(250);
  await auditViewport(page, '3D U.S. quarter flip overlay after animation progress');
});

test('checkout return routes are mobile-safe', async ({ page }) => {
  const cases = [
    ['premium checkout success', '/?checkout=success&kind=premium3d&session_id=audit-premium'],
    ['premium checkout cancel', '/?checkout=cancel&kind=premium3d'],
    ['tournament checkout success', '/?checkout=success&kind=tournament&session_id=audit-tournament'],
  ] as const;

  for (const [label, url] of cases) {
    await gotoAudit(page, url);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForTimeout(150);
    await auditViewport(page, label, true);
  }
});

test('paid room checkout return and reconnect states remain inside the mobile viewport', async ({ page }) => {
  await installRoomSocket(page, 'RECONNECTING', STANDARD_FEN);
  await gotoAudit(page, `/?room=${ROOM_CODE}&checkout=success&kind=position_bid&session_id=audit-bid`);
  await expect(page.locator('.online-board-frame')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.match-turn-note')).toContainText('Opponent reconnecting');
  await auditViewport(page, 'server-side opponent reconnect state after checkout return', true);

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.match-turn-note')).toContainText('Reconnecting');
  await auditViewport(page, 'local network reconnect state after checkout return', true);
});

test('dynamic rotation after a live mobile page does not introduce overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await gotoAudit(page);
  await auditViewport(page, 'portrait before rotation');

  await page.setViewportSize({ width: 844, height: 390 });
  await setSafeArea(page, LANDSCAPE_SAFE_AREA);
  await auditViewport(page, 'landscape after runtime rotation', true);

  await page.setViewportSize({ width: 390, height: 664 });
  await setSafeArea(page, PORTRAIT_SAFE_AREA);
  await auditViewport(page, 'portrait after rotating back', true);
});
