import { CATALOG, FREE_HUMAN_MATCHES_PER_MONTH, type CatalogItemId } from '../../shared/catalog';
import { ratingClassForTimeControl, type TimeControl, type TimeControlPresetId } from '../../shared/timeControl';
import type { BoardAppearance } from '../onboarding/preferences';
import { grantPremium3DReceipt, hasPremium3DReceipt } from './access';

const KEY = 'qqurz:entitlements-v1';
const MATCHES_KEY = 'qqurz:human-matches-v1';
const CHAT_KEY = 'qqurz:chat-pref';
const TAKEBACK_KEY = 'qqurz:takebacks-pref';
const RATED_KEY = 'qqurz:rated-pref';
const PIECE_THEME_KEY = 'qqurz:piece-theme';

export type PieceTheme = 'classic' | 'warm';

export type Entitlements = {
  subscriptionUntil: number;
  premium3d: boolean;
  themes: { tournament: boolean; slate: boolean };
  piecesWarm: boolean;
  blitzUntil: number;
  updatedAt: number;
};

type MatchLedger = { month: string; count: number };

const EMPTY: Entitlements = {
  subscriptionUntil: 0,
  premium3d: false,
  themes: { tournament: false, slate: false },
  piecesWarm: false,
  blitzUntil: 0,
  updatedAt: 0,
};

function monthKey(at = Date.now()): string {
  const date = new Date(at);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) as T } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function loadEntitlements(): Entitlements {
  const stored = readJson<Entitlements>(KEY, EMPTY);
  return {
    ...EMPTY,
    ...stored,
    themes: { ...EMPTY.themes, ...stored.themes },
    premium3d: stored.premium3d || hasPremium3DReceipt(),
  };
}

export function saveEntitlements(next: Entitlements): Entitlements {
  const value = { ...next, updatedAt: Date.now() };
  writeJson(KEY, value);
  return value;
}

export function hasFreestyle(): boolean {
  return loadEntitlements().subscriptionUntil > Date.now();
}

export function hasPremium3D(): boolean {
  const entitlements = loadEntitlements();
  return entitlements.premium3d || hasFreestyle() || hasPremium3DReceipt();
}

export function hasBoardTheme(value: BoardAppearance): boolean {
  if (value === 'walnut') return true;
  if (hasFreestyle()) return true;
  const entitlements = loadEntitlements();
  return value === 'tournament' ? entitlements.themes.tournament : entitlements.themes.slate;
}

export function hasWarmPieces(): boolean {
  return hasFreestyle() || loadEntitlements().piecesWarm;
}

export function hasBlitzAccess(): boolean {
  if (hasFreestyle()) return true;
  return loadEntitlements().blitzUntil > Date.now();
}

export function canUseTimeControl(control: TimeControl): boolean {
  const ratingClass = ratingClassForTimeControl(control.baseMs, control.incrementMs);
  if (ratingClass === 'rapid') return true;
  return hasBlitzAccess();
}

export function allowedTimePresetIds(): TimeControlPresetId[] {
  return hasBlitzAccess() ? ['3+2', '5+0', '10+5'] : ['10+5'];
}

export function resolvedBoardAppearance(value: BoardAppearance): BoardAppearance {
  return hasBoardTheme(value) ? value : 'walnut';
}

export function cycleOwnedBoardAppearance(value: BoardAppearance): BoardAppearance {
  const order: BoardAppearance[] = ['walnut', 'tournament', 'slate'];
  const start = Math.max(0, order.indexOf(value));
  for (let i = 1; i <= order.length; i += 1) {
    const next = order[(start + i) % order.length];
    if (hasBoardTheme(next)) return next;
  }
  return 'walnut';
}

export function humanMatchBlockReason(): string | null {
  if (hasFreestyle()) return null;
  if (humanMatchesRemaining() <= 0) return 'Free play includes ten casual human matches a month. Freestyle unlocks unlimited games.';
  return null;
}

export function humanMatchesRemaining(): number {
  if (hasFreestyle()) return Number.POSITIVE_INFINITY;
  const ledger = readJson<MatchLedger>(MATCHES_KEY, { month: monthKey(), count: 0 });
  const current = ledger.month === monthKey() ? ledger.count : 0;
  return Math.max(0, FREE_HUMAN_MATCHES_PER_MONTH - current);
}

export function consumeHumanMatch(): { ok: boolean; remaining: number } {
  if (hasFreestyle()) return { ok: true, remaining: Number.POSITIVE_INFINITY };
  const remaining = humanMatchesRemaining();
  if (remaining <= 0) return { ok: false, remaining: 0 };
  writeJson(MATCHES_KEY, { month: monthKey(), count: FREE_HUMAN_MATCHES_PER_MONTH - remaining + 1 });
  return { ok: true, remaining: remaining - 1 };
}

export function grantCatalogItem(id: CatalogItemId, sessionId?: string | null): Entitlements {
  const current = loadEntitlements();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (id === '3d-pass') {
    grantPremium3DReceipt(sessionId);
    current.premium3d = true;
  }
  if (id === 'theme-green') current.themes.tournament = true;
  if (id === 'theme-slate') current.themes.slate = true;
  if (id === 'pieces-warm') current.piecesWarm = true;
  if (id === 'blitz-day') current.blitzUntil = Math.max(current.blitzUntil, now) + day;
  if (id === 'blitz-month') current.blitzUntil = Math.max(current.blitzUntil, now) + 30 * day;
  if (id === 'sub-monthly') current.subscriptionUntil = Math.max(current.subscriptionUntil, now) + 30 * day;
  if (id === 'sub-quarterly') current.subscriptionUntil = Math.max(current.subscriptionUntil, now) + 91 * day;
  if (id === 'sub-six') current.subscriptionUntil = Math.max(current.subscriptionUntil, now) + 182 * day;
  if (id === 'sub-annual') current.subscriptionUntil = Math.max(current.subscriptionUntil, now) + 365 * day;
  return saveEntitlements(current);
}

export function grantFromCheckout(itemId: string, sessionId?: string | null): Entitlements | null {
  if (!(itemId in CATALOG)) return null;
  return grantCatalogItem(itemId as CatalogItemId, sessionId);
}

export function loadPieceTheme(): PieceTheme {
  try {
    return window.localStorage.getItem(PIECE_THEME_KEY) === 'warm' && hasWarmPieces() ? 'warm' : 'classic';
  } catch {
    return 'classic';
  }
}

export function savePieceTheme(value: PieceTheme): void {
  try { window.localStorage.setItem(PIECE_THEME_KEY, value); } catch { /* optional */ }
}

export function loadChatPreference(): boolean {
  try { return window.localStorage.getItem(CHAT_KEY) !== 'off'; } catch { return true; }
}

export function saveChatPreference(enabled: boolean): void {
  writeJson(CHAT_KEY, enabled ? 'on' : 'off');
  try { window.localStorage.setItem(CHAT_KEY, enabled ? 'on' : 'off'); } catch { /* optional */ }
}

export function loadTakebackPreference(): boolean {
  try { return window.localStorage.getItem(TAKEBACK_KEY) !== 'off'; } catch { return true; }
}

export function saveTakebackPreference(enabled: boolean): void {
  try { window.localStorage.setItem(TAKEBACK_KEY, enabled ? 'on' : 'off'); } catch { /* optional */ }
}

export function loadRatedPreference(): boolean {
  if (!hasFreestyle()) return false;
  try { return window.localStorage.getItem(RATED_KEY) === 'on'; } catch { return false; }
}

export function saveRatedPreference(enabled: boolean): void {
  try { window.localStorage.setItem(RATED_KEY, enabled ? 'on' : 'off'); } catch { /* optional */ }
}

export function applyPieceThemeToDocument(value = loadPieceTheme()): void {
  document.documentElement.dataset.pieceTheme = hasWarmPieces() ? value : 'classic';
}
