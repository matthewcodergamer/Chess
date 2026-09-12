import type { AccountEnv } from './accounts';
import { resolveAccountSession } from './accounts';
import { IntegrityChessRoom } from './integrityRoom';
import {
  IntegrityReviewRegistry,
  type IntegrityEnv,
  type IntegrityGameEvidence,
  type IntegrityRegistryEnv,
  type IntegritySettlementDisposition,
} from './integrityReview';

export const FAIR_PLAY_POLICY_VERSION = '2026-09-12.v1';
export const FAIR_PLAY_POLICY = Object.freeze([
  'Play every competitive game yourself. No chess engines, AI, outside move suggestions, or another person choosing moves.',
  'Use one competitive account. Do not collude, boost, intentionally lose rating, or manipulate tournament results.',
  'Play at a reasonable pace. Do not intentionally stall, repeatedly abandon games, or abuse disconnects to avoid a result.',
  'Treat opponents respectfully. Reports and automated signals are reviewed as evidence; they are not automatic cheating findings.',
  'Funded games and prizes may be held for manual fair-play review before money is released.',
]);

type FairPlayAcceptance = { accountId: string; version: string; acceptedAt: number };
export type FairPlayReportReason = 'engine_assistance' | 'stalling' | 'abuse' | 'sandbagging' | 'multi_account' | 'disconnect_abuse' | 'other';
type FairPlayReport = {
  id: string;
  reporterAccountId: string;
  targetAccountId: string;
  gameId: string | null;
  roomCode: string | null;
  tournamentId: string | null;
  money: boolean;
  reason: FairPlayReportReason;
  details: string;
  createdAt: number;
  status: 'open' | 'reviewed' | 'dismissed' | 'escalated';
  moderatorNotes: Array<{ reviewerId: string; note: string; at: number }>;
};

type FairPlaySignalCode =
  | 'repeated_no_move_losses'
  | 'repeated_timeouts'
  | 'disconnect_timeout_pattern'
  | 'stalling_pattern'
  | 'early_abandon_pattern'
  | 'possible_sandbagging_pattern'
  | 'multi_account_device_link'
  | 'multi_account_network_link'
  | 'player_report';

type FairPlayCase = {
  id: string;
  accountId: string;
  gameId: string | null;
  tournamentId: string | null;
  money: boolean;
  priority: 'standard' | 'medium' | 'high';
  status: 'queued' | 'in_review' | 'second_review' | 'cleared' | 'escalated' | 'action_required';
  signals: Array<{ code: FairPlaySignalCode; detail: string }>;
  sourceReportIds: string[];
  reviewers: string[];
  notes: Array<{ reviewerId: string; note: string; at: number }>;
  createdAt: number;
  updatedAt: number;
  disclaimer: string;
};

type BehaviorEvent = {
  schema: 'qqurz-fair-play-behavior-v1';
  gameId: string;
  roomCode: string;
  tournamentId: string | null;
  money: boolean;
  finalizedAt: number;
  resultKind: string | null;
  moveCount: number;
  winnerAccountId: string | null;
  loserAccountId: string | null;
  explicitAbandonAccountId: string | null;
  finalIdleMs: number;
  reconnectsByAccount: Record<string, number>;
  players: Array<{ accountId: string | null; color: 'white' | 'black' }>;
};

type BehaviorSample = {
  gameId: string;
  at: number;
  loss: boolean;
  noMoveLoss: boolean;
  timeoutLoss: boolean;
  disconnectTimeout: boolean;
  earlyAbandon: boolean;
  stalling: boolean;
};

type PlayerBehaviorStats = {
  accountId: string;
  competitiveGames: number;
  timeoutLosses: number;
  noMoveLosses: number;
  disconnectTimeouts: number;
  earlyAbandons: number;
  stallingFlags: number;
  recent: BehaviorSample[];
  updatedAt: number;
};

type BlockRecord = { accountId: string; blockedAccountIds: string[]; updatedAt: number };
type SignalLink = { accounts: string[]; lastSeenAt: number; gameIds: string[] };

type FairPlayEnv = IntegrityEnv & AccountEnv;
type RegistryStub = { fetch(request: Request): Promise<Response> };

const ACCEPT_PREFIX = 'fair-play:accept:v1:';
const BLOCK_PREFIX = 'fair-play:blocks:v1:';
const REPORT_PREFIX = 'fair-play:report:v1:';
const REPORT_INDEX = 'fair-play:report-index:v1';
const CASE_PREFIX = 'fair-play:case:v1:';
const CASE_INDEX = 'fair-play:case-index:v1';
const GAME_CASE_PREFIX = 'fair-play:game-cases:v1:';
const TOURNAMENT_CASE_PREFIX = 'fair-play:tournament-cases:v1:';
const PLAYER_CASE_PREFIX = 'fair-play:player-cases:v1:';
const STATS_PREFIX = 'fair-play:stats:v1:';
const DEVICE_LINK_PREFIX = 'fair-play:device-link:v1:';
const NETWORK_LINK_PREFIX = 'fair-play:network-link:v1:';
const BEHAVIOR_RECORDED_PREFIX = 'fair-play:behavior-recorded:v1:';
const GAME_INDEX_PREFIX = 'fair-play:room-game:v1:';
const MAX_INDEX = 5000;
const MAX_RECENT = 24;
const MAX_BLOCKS = 500;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function clean(value: unknown, max = 300): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function validReason(value: unknown): value is FairPlayReportReason {
  return ['engine_assistance', 'stalling', 'abuse', 'sandbagging', 'multi_account', 'disconnect_abuse', 'other'].includes(String(value));
}
function registry(env: IntegrityEnv): RegistryStub | null {
  if (!env.INTEGRITY) return null;
  return env.INTEGRITY.get(env.INTEGRITY.idFromName('qqurz-integrity-review-registry-v1')) as unknown as RegistryStub;
}
async function internalCall(env: IntegrityEnv, path: string, init: RequestInit = {}): Promise<Response | null> {
  const target = registry(env);
  if (!target || !env.INTEGRITY_INTERNAL_SECRET) return null;
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('x-integrity-internal', env.INTEGRITY_INTERNAL_SECRET);
  return target.fetch(new Request(`https://integrity.internal${path}`, { ...init, headers }));
}

export async function fairPlayStatus(env: IntegrityEnv, accountId: string): Promise<{ configured: boolean; accepted: boolean; version: string; acceptedAt: number | null }> {
  const response = await internalCall(env, `/internal/fair-play/status/${encodeURIComponent(accountId)}`);
  if (!response?.ok) return { configured: Boolean(response), accepted: false, version: FAIR_PLAY_POLICY_VERSION, acceptedAt: null };
  const body = await response.json().catch(() => ({})) as { accepted?: boolean; version?: string; acceptedAt?: number | null };
  return { configured: true, accepted: body.accepted === true, version: body.version ?? FAIR_PLAY_POLICY_VERSION, acceptedAt: body.acceptedAt ?? null };
}

export async function areCompetitivelyBlocked(env: IntegrityEnv, accountA: string, accountB: string): Promise<boolean> {
  if (!accountA || !accountB || accountA === accountB) return false;
  const response = await internalCall(env, `/internal/fair-play/blocked/${encodeURIComponent(accountA)}/${encodeURIComponent(accountB)}`);
  if (!response?.ok) return false;
  return Boolean((await response.json().catch(() => ({})) as { blocked?: boolean }).blocked);
}

export async function submitFairPlayReport(env: IntegrityEnv, input: {
  reporterAccountId: string;
  targetAccountId: string;
  gameId?: string | null;
  roomCode?: string | null;
  tournamentId?: string | null;
  money?: boolean;
  reason: FairPlayReportReason;
  details?: string;
}): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const response = await internalCall(env, '/internal/fair-play/report', { method: 'POST', body: JSON.stringify(input) });
  if (!response) return { ok: false, error: 'Fair-play review service is not configured.' };
  const body = await response.json().catch(() => ({})) as { reportId?: string; error?: string };
  return response.ok ? { ok: true, reportId: body.reportId } : { ok: false, error: body.error ?? 'Report could not be recorded.' };
}

export async function setCompetitiveBlock(env: IntegrityEnv, accountId: string, targetAccountId: string, blocked: boolean): Promise<{ ok: boolean; error?: string }> {
  const response = await internalCall(env, '/internal/fair-play/block', { method: 'POST', body: JSON.stringify({ accountId, targetAccountId, blocked }) });
  if (!response) return { ok: false, error: 'Fair-play service is not configured.' };
  const body = await response.json().catch(() => ({})) as { error?: string };
  return response.ok ? { ok: true } : { ok: false, error: body.error ?? 'Block update failed.' };
}

export async function submitBehaviorEvent(env: IntegrityEnv, event: BehaviorEvent): Promise<void> {
  await internalCall(env, '/internal/fair-play/behavior', { method: 'POST', body: JSON.stringify(event) });
}

export async function handleFairPlayRequest(request: Request, env: FairPlayEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/fair-play/')) return null;
  const identity = await resolveAccountSession(request, env);

  if (url.pathname === '/fair-play/policy' && request.method === 'GET') {
    const status = identity ? await fairPlayStatus(env, identity.id) : { configured: Boolean(env.INTEGRITY), accepted: false, version: FAIR_PLAY_POLICY_VERSION, acceptedAt: null };
    return json({ rules: FAIR_PLAY_POLICY, identity: identity ? { id: identity.id, displayName: identity.displayName } : null, ...status });
  }
  if (url.pathname === '/fair-play/accept' && request.method === 'POST') {
    if (!identity) return json({ error: 'Sign in before accepting competitive fair-play rules.' }, 401);
    const response = await internalCall(env, '/internal/fair-play/accept', { method: 'POST', body: JSON.stringify({ accountId: identity.id, version: FAIR_PLAY_POLICY_VERSION }) });
    if (!response) return json({ error: 'Fair-play service is not configured.' }, 503);
    return new Response(response.body, { status: response.status, headers: response.headers });
  }
  if (url.pathname === '/fair-play/block' && request.method === 'POST') {
    if (!identity) return json({ error: 'Sign in to block a competitive player.' }, 401);
    const body = await request.json().catch(() => ({})) as { targetAccountId?: string; blocked?: boolean };
    const targetAccountId = clean(body.targetAccountId, 80);
    if (!targetAccountId || targetAccountId === identity.id) return json({ error: 'Invalid player block.' }, 400);
    const result = await setCompetitiveBlock(env, identity.id, targetAccountId, body.blocked !== false);
    return result.ok ? json({ ok: true }) : json({ error: result.error }, 503);
  }
  return json({ error: 'Fair-play route not found.' }, 404);
}

export async function requireFairPlayForCompetitiveRequest(request: Request, env: FairPlayEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const competitive = request.method === 'POST' && (
    url.pathname === '/matchmaking/enqueue'
    || /^\/tournament-engine\/tournaments\/event_[a-f0-9]{32}\/(register|check-in)$/.test(url.pathname)
  );
  if (!competitive) return null;
  const identity = await resolveAccountSession(request, env);
  if (!identity) return json({ error: 'Sign in to enter competitive play.', code: 'COMPETITIVE_SIGN_IN_REQUIRED' }, 401);
  const status = await fairPlayStatus(env, identity.id);
  if (!status.configured) return json({ error: 'Competitive fair-play service is not configured.', code: 'FAIR_PLAY_SERVICE_UNAVAILABLE' }, 503);
  if (!status.accepted) return json({ error: 'Accept the current fair-play policy before entering competitive play.', code: 'FAIR_PLAY_REQUIRED', fairPlayVersion: FAIR_PLAY_POLICY_VERSION }, 428);
  return null;
}

export class FairPlayIntegrityRegistry extends IntegrityReviewRegistry {
  private fpInternals(): { ctx: DurableObjectState; env: IntegrityRegistryEnv } {
    return this as unknown as { ctx: DurableObjectState; env: IntegrityRegistryEnv };
  }
  private fairPlayInternalAuthorized(request: Request): boolean {
    const secret = this.fpInternals().env.INTEGRITY_INTERNAL_SECRET ?? '';
    return Boolean(secret) && request.headers.get('x-integrity-internal') === secret;
  }
  private fairPlayAdminAuthorized(request: Request): boolean {
    const secret = this.fpInternals().env.INTEGRITY_ADMIN_SECRET ?? '';
    return secret.length >= 24 && request.headers.get('x-integrity-admin') === secret;
  }
  private async accountBlocks(accountId: string): Promise<BlockRecord> {
    return (await this.fpInternals().ctx.storage.get<BlockRecord>(`${BLOCK_PREFIX}${accountId}`)) ?? { accountId, blockedAccountIds: [], updatedAt: 0 };
  }
  private async appendIndex(key: string, id: string, max = MAX_INDEX): Promise<void> {
    const ctx = this.fpInternals().ctx;
    const index = (await ctx.storage.get<string[]>(key)) ?? [];
    await ctx.storage.put(key, [id, ...index.filter(value => value !== id)].slice(0, max));
  }
  private async createCase(input: Omit<FairPlayCase, 'id' | 'createdAt' | 'updatedAt' | 'reviewers' | 'notes' | 'disclaimer'>): Promise<FairPlayCase> {
    const ctx = this.fpInternals().ctx;
    const now = Date.now();
    const id = `fp_${crypto.randomUUID().replaceAll('-', '')}`;
    const record: FairPlayCase = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      reviewers: [],
      notes: [],
      disclaimer: 'Automated fair-play signals and player reports are review evidence only. They are not automatic findings or penalties.',
    };
    await ctx.storage.put(`${CASE_PREFIX}${id}`, record);
    await this.appendIndex(CASE_INDEX, id);
    await this.appendIndex(`${PLAYER_CASE_PREFIX}${record.accountId}`, id, 250);
    if (record.gameId) await this.appendIndex(`${GAME_CASE_PREFIX}${record.gameId}`, id, 50);
    if (record.tournamentId) await this.appendIndex(`${TOURNAMENT_CASE_PREFIX}${record.tournamentId}`, id, 500);
    return record;
  }
  private async openCaseForSignal(accountId: string, code: FairPlaySignalCode, detail: string, context: { gameId?: string | null; tournamentId?: string | null; money?: boolean } = {}): Promise<FairPlayCase> {
    const recentIds = (await this.fpInternals().ctx.storage.get<string[]>(`${PLAYER_CASE_PREFIX}${accountId}`)) ?? [];
    for (const id of recentIds.slice(0, 30)) {
      const item = await this.fpInternals().ctx.storage.get<FairPlayCase>(`${CASE_PREFIX}${id}`);
      if (item && item.status !== 'cleared' && item.signals.some(signal => signal.code === code) && Date.now() - item.updatedAt < 7 * 24 * 60 * 60_000) {
        if (!item.signals.some(signal => signal.detail === detail)) item.signals.push({ code, detail });
        item.updatedAt = Date.now();
        await this.fpInternals().ctx.storage.put(`${CASE_PREFIX}${item.id}`, item);
        return item;
      }
    }
    return this.createCase({
      accountId,
      gameId: context.gameId ?? null,
      tournamentId: context.tournamentId ?? null,
      money: Boolean(context.money),
      priority: context.money ? 'high' : context.tournamentId ? 'medium' : 'standard',
      status: 'queued',
      signals: [{ code, detail }],
      sourceReportIds: [],
    });
  }
  private async fairPlayAcceptance(accountId: string): Promise<FairPlayAcceptance | null> {
    return (await this.fpInternals().ctx.storage.get<FairPlayAcceptance>(`${ACCEPT_PREFIX}${accountId}`)) ?? null;
  }
  private async behavior(event: BehaviorEvent): Promise<Response> {
    if (!event || event.schema !== 'qqurz-fair-play-behavior-v1' || !clean(event.gameId, 180)) return json({ error: 'Invalid behavior event.' }, 400);
    const ctx = this.fpInternals().ctx;
    if (await ctx.storage.get<boolean>(`${BEHAVIOR_RECORDED_PREFIX}${event.gameId}`)) return json({ ok: true, duplicate: true });
    const generatedCases: string[] = [];
    for (const player of event.players) {
      if (!player.accountId) continue;
      const isLoser = player.accountId === event.loserAccountId;
      const reconnects = Math.max(0, Number(event.reconnectsByAccount?.[player.accountId] ?? 0));
      const timeoutLoss = isLoser && event.resultKind === 'TIMEOUT';
      const noMoveLoss = isLoser && event.moveCount <= 2 && (event.resultKind === 'TIMEOUT' || event.explicitAbandonAccountId === player.accountId);
      const disconnectTimeout = timeoutLoss && reconnects > 0;
      const earlyAbandon = event.explicitAbandonAccountId === player.accountId && event.moveCount < 10;
      const stalling = timeoutLoss && event.moveCount >= 6 && event.finalIdleMs >= 60_000;
      const prior = (await ctx.storage.get<PlayerBehaviorStats>(`${STATS_PREFIX}${player.accountId}`)) ?? {
        accountId: player.accountId, competitiveGames: 0, timeoutLosses: 0, noMoveLosses: 0, disconnectTimeouts: 0, earlyAbandons: 0, stallingFlags: 0, recent: [], updatedAt: 0,
      };
      const sample: BehaviorSample = { gameId: event.gameId, at: event.finalizedAt, loss: isLoser, noMoveLoss, timeoutLoss, disconnectTimeout, earlyAbandon, stalling };
      const next: PlayerBehaviorStats = {
        ...prior,
        competitiveGames: prior.competitiveGames + 1,
        timeoutLosses: prior.timeoutLosses + (timeoutLoss ? 1 : 0),
        noMoveLosses: prior.noMoveLosses + (noMoveLoss ? 1 : 0),
        disconnectTimeouts: prior.disconnectTimeouts + (disconnectTimeout ? 1 : 0),
        earlyAbandons: prior.earlyAbandons + (earlyAbandon ? 1 : 0),
        stallingFlags: prior.stallingFlags + (stalling ? 1 : 0),
        recent: [sample, ...prior.recent.filter(item => item.gameId !== event.gameId)].slice(0, MAX_RECENT),
        updatedAt: Date.now(),
      };
      await ctx.storage.put(`${STATS_PREFIX}${player.accountId}`, next);
      const recent10 = next.recent.slice(0, 10);
      const count = (key: keyof Pick<BehaviorSample, 'noMoveLoss' | 'timeoutLoss' | 'disconnectTimeout' | 'earlyAbandon' | 'stalling'>) => recent10.filter(item => item[key]).length;
      const context = { gameId: event.gameId, tournamentId: event.tournamentId, money: event.money };
      if (count('noMoveLoss') >= 3) generatedCases.push((await this.openCaseForSignal(player.accountId, 'repeated_no_move_losses', `${count('noMoveLoss')} of the last ${recent10.length} games ended as zero/very-low-move losses.`, context)).id);
      if (count('timeoutLoss') >= 4) generatedCases.push((await this.openCaseForSignal(player.accountId, 'repeated_timeouts', `${count('timeoutLoss')} of the last ${recent10.length} games were timeout losses.`, context)).id);
      if (count('disconnectTimeout') >= 3) generatedCases.push((await this.openCaseForSignal(player.accountId, 'disconnect_timeout_pattern', `${count('disconnectTimeout')} recent timeout losses also involved reconnect activity.`, context)).id);
      if (count('earlyAbandon') >= 3) generatedCases.push((await this.openCaseForSignal(player.accountId, 'early_abandon_pattern', `${count('earlyAbandon')} recent games were explicitly abandoned very early.`, context)).id);
      if (count('stalling') >= 3) generatedCases.push((await this.openCaseForSignal(player.accountId, 'stalling_pattern', `${count('stalling')} recent timeout losses contained a long final inactivity period.`, context)).id);
      const shortLosses = recent10.filter(item => item.loss && (item.noMoveLoss || item.earlyAbandon || item.timeoutLoss)).length;
      if (next.competitiveGames >= 10 && shortLosses >= 6) generatedCases.push((await this.openCaseForSignal(player.accountId, 'possible_sandbagging_pattern', `${shortLosses} of the last ${recent10.length} games were short/timeout/abandon losses. Review for possible rating manipulation; do not infer intent automatically.`, context)).id);
    }
    await ctx.storage.put(`${BEHAVIOR_RECORDED_PREFIX}${event.gameId}`, true);
    return json({ ok: true, caseIds: [...new Set(generatedCases)] });
  }
  private async linkSignals(evidence: IntegrityGameEvidence): Promise<FairPlayCase[]> {
    const ctx = this.fpInternals().ctx;
    const cases: FairPlayCase[] = [];
    const byHash = async (prefix: string, hash: string, accountId: string, gameId: string): Promise<SignalLink> => {
      const key = `${prefix}${hash}`;
      const current = (await ctx.storage.get<SignalLink>(key)) ?? { accounts: [], lastSeenAt: 0, gameIds: [] };
      const next: SignalLink = {
        accounts: [...new Set([...current.accounts, accountId])].slice(-20),
        lastSeenAt: evidence.finalizedAt,
        gameIds: [gameId, ...current.gameIds.filter(id => id !== gameId)].slice(0, 50),
      };
      await ctx.storage.put(key, next);
      return next;
    };
    for (const signal of evidence.connections) {
      if (!signal.accountId) continue;
      if (signal.deviceSignalHash) {
        const link = await byHash(DEVICE_LINK_PREFIX, signal.deviceSignalHash, signal.accountId, evidence.gameId);
        if (link.accounts.length >= 3) cases.push(await this.openCaseForSignal(signal.accountId, 'multi_account_device_link', `A pseudonymous device signal has appeared on ${link.accounts.length} competitive accounts. Shared devices are possible; manual review is required before any action.`, { gameId: evidence.gameId, tournamentId: evidence.tournamentId, money: evidence.money }));
      }
      if (signal.networkSignalHash) {
        const link = await byHash(NETWORK_LINK_PREFIX, signal.networkSignalHash, signal.accountId, evidence.gameId);
        if (link.accounts.length >= 5) cases.push(await this.openCaseForSignal(signal.accountId, 'multi_account_network_link', `A pseudonymous network-prefix signal has appeared on ${link.accounts.length} competitive accounts. Shared households/networks are common; this is a weak review signal only.`, { gameId: evidence.gameId, tournamentId: evidence.tournamentId, money: evidence.money }));
      }
    }
    return cases;
  }
  private async fairPlayDisposition(gameId: string, base: IntegritySettlementDisposition): Promise<IntegritySettlementDisposition> {
    const ids = (await this.fpInternals().ctx.storage.get<string[]>(`${GAME_CASE_PREFIX}${gameId}`)) ?? [];
    const cases = (await Promise.all(ids.map(id => this.fpInternals().ctx.storage.get<FairPlayCase>(`${CASE_PREFIX}${id}`)))).filter((item): item is FairPlayCase => item !== undefined);
    const open = cases.find(item => item.money && item.status !== 'cleared');
    if (open) return { gameId, disposition: 'manual_review', reviewCaseId: open.id, reason: 'Funded settlement is paused for fair-play review.' };
    return base;
  }
  private async report(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const reporterAccountId = clean(body.reporterAccountId, 80);
    const targetAccountId = clean(body.targetAccountId, 80);
    const reason = body.reason;
    if (!reporterAccountId || !targetAccountId || reporterAccountId === targetAccountId || !validReason(reason)) return json({ error: 'Invalid player report.' }, 400);
    const gameId = clean(body.gameId, 180) || null;
    const roomCode = clean(body.roomCode, 12) || null;
    const tournamentId = clean(body.tournamentId, 80) || null;
    const dedupe = `fair-play:report-dedupe:v1:${reporterAccountId}:${targetAccountId}:${gameId ?? roomCode ?? 'general'}:${reason}`;
    const existingId = await this.fpInternals().ctx.storage.get<string>(dedupe);
    if (existingId) return json({ ok: true, duplicate: true, reportId: existingId });
    const id = `report_${crypto.randomUUID().replaceAll('-', '')}`;
    const report: FairPlayReport = {
      id, reporterAccountId, targetAccountId, gameId, roomCode, tournamentId, money: body.money === true,
      reason, details: clean(body.details, 800), createdAt: Date.now(), status: 'open', moderatorNotes: [],
    };
    await this.fpInternals().ctx.storage.put({ [`${REPORT_PREFIX}${id}`]: report, [dedupe]: id });
    await this.appendIndex(REPORT_INDEX, id);
    const playerReportsKey = `fair-play:reports-for:v1:${targetAccountId}`;
    await this.appendIndex(playerReportsKey, id, 250);
    const reportIds = (await this.fpInternals().ctx.storage.get<string[]>(playerReportsKey)) ?? [];
    const recentReports = (await Promise.all(reportIds.slice(0, 20).map(value => this.fpInternals().ctx.storage.get<FairPlayReport>(`${REPORT_PREFIX}${value}`))))
      .filter((item): item is FairPlayReport => item !== undefined && Date.now() - item.createdAt < 30 * 24 * 60 * 60_000);
    const distinctReporters = new Set(recentReports.map(item => item.reporterAccountId));
    const review = await this.openCaseForSignal(targetAccountId, 'player_report', `${distinctReporters.size} distinct player(s) submitted recent fair-play reports. Reports require evidence review and are not findings by themselves.`, { gameId, tournamentId, money: report.money });
    if (!review.sourceReportIds.includes(id)) {
      review.sourceReportIds = [id, ...review.sourceReportIds].slice(0, 100);
      review.updatedAt = Date.now();
      await this.fpInternals().ctx.storage.put(`${CASE_PREFIX}${review.id}`, review);
    }
    return json({ ok: true, reportId: id, reviewCaseId: review.id }, 201);
  }
  private async moderatorList(request: Request, kind: 'reports' | 'cases'): Promise<Response> {
    if (!this.fairPlayAdminAuthorized(request)) return json({ error: 'Unauthorized moderator access.' }, 401);
    const url = new URL(request.url);
    const status = clean(url.searchParams.get('status'), 40);
    const indexKey = kind === 'reports' ? REPORT_INDEX : CASE_INDEX;
    const prefix = kind === 'reports' ? REPORT_PREFIX : CASE_PREFIX;
    const ids = (await this.fpInternals().ctx.storage.get<string[]>(indexKey)) ?? [];
    const items = (await Promise.all(ids.slice(0, 300).map(id => this.fpInternals().ctx.storage.get<any>(`${prefix}${id}`)))).filter(Boolean);
    return json({ [kind]: status ? items.filter(item => item.status === status) : items });
  }
  private async moderatorPlayer(request: Request, accountId: string): Promise<Response> {
    if (!this.fairPlayAdminAuthorized(request)) return json({ error: 'Unauthorized moderator access.' }, 401);
    const stats = (await this.fpInternals().ctx.storage.get<PlayerBehaviorStats>(`${STATS_PREFIX}${accountId}`)) ?? null;
    const caseIds = (await this.fpInternals().ctx.storage.get<string[]>(`${PLAYER_CASE_PREFIX}${accountId}`)) ?? [];
    const reportIds = (await this.fpInternals().ctx.storage.get<string[]>(`fair-play:reports-for:v1:${accountId}`)) ?? [];
    const cases = (await Promise.all(caseIds.slice(0, 100).map(id => this.fpInternals().ctx.storage.get<FairPlayCase>(`${CASE_PREFIX}${id}`)))).filter(Boolean);
    const reports = (await Promise.all(reportIds.slice(0, 100).map(id => this.fpInternals().ctx.storage.get<FairPlayReport>(`${REPORT_PREFIX}${id}`)))).filter(Boolean);
    return json({ accountId, stats, cases, reports });
  }
  private async moderatorCaseDecision(request: Request, caseId: string): Promise<Response> {
    if (!this.fairPlayAdminAuthorized(request)) return json({ error: 'Unauthorized moderator access.' }, 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const reviewerId = clean(body.reviewerId, 80);
    const note = clean(body.note, 800);
    const decision = clean(body.decision, 32);
    if (!reviewerId || !note || !['clear', 'escalate', 'action_required'].includes(decision)) return json({ error: 'Reviewer, note and decision are required.' }, 400);
    const key = `${CASE_PREFIX}${caseId}`;
    const record = await this.fpInternals().ctx.storage.get<FairPlayCase>(key);
    if (!record) return json({ error: 'Fair-play case not found.' }, 404);
    if (!record.reviewers.includes(reviewerId)) record.reviewers.push(reviewerId);
    record.notes.push({ reviewerId, note, at: Date.now() });
    if (decision === 'clear') record.status = 'cleared';
    else if (decision === 'escalate') record.status = 'escalated';
    else if (record.money && new Set(record.reviewers).size < 2) record.status = 'second_review';
    else record.status = 'action_required';
    record.updatedAt = Date.now();
    await this.fpInternals().ctx.storage.put(key, record);
    return json({ case: record, adverseActionAuthorized: record.status === 'action_required', requiresSecondReviewer: record.status === 'second_review' });
  }
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/internal/fair-play/') && !this.fairPlayInternalAuthorized(request)) return json({ error: 'Unauthorized fair-play service call.' }, 401);
    if (url.pathname.startsWith('/admin/fair-play/') && !this.fairPlayAdminAuthorized(request)) return json({ error: 'Unauthorized moderator access.' }, 401);

    const statusMatch = /^\/internal\/fair-play\/status\/(.+)$/.exec(url.pathname);
    if (statusMatch && request.method === 'GET') {
      const accountId = decodeURIComponent(statusMatch[1]);
      const record = await this.fairPlayAcceptance(accountId);
      return json({ accepted: record?.version === FAIR_PLAY_POLICY_VERSION, version: FAIR_PLAY_POLICY_VERSION, acceptedAt: record?.version === FAIR_PLAY_POLICY_VERSION ? record.acceptedAt : null });
    }
    if (url.pathname === '/internal/fair-play/accept' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const accountId = clean(body.accountId, 80);
      if (!accountId || body.version !== FAIR_PLAY_POLICY_VERSION) return json({ error: 'Invalid fair-play policy acceptance.' }, 400);
      const record: FairPlayAcceptance = { accountId, version: FAIR_PLAY_POLICY_VERSION, acceptedAt: Date.now() };
      await this.fpInternals().ctx.storage.put(`${ACCEPT_PREFIX}${accountId}`, record);
      return json({ ok: true, accepted: true, version: record.version, acceptedAt: record.acceptedAt });
    }
    const blockedMatch = /^\/internal\/fair-play\/blocked\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (blockedMatch && request.method === 'GET') {
      const a = decodeURIComponent(blockedMatch[1]);
      const b = decodeURIComponent(blockedMatch[2]);
      const [left, right] = await Promise.all([this.accountBlocks(a), this.accountBlocks(b)]);
      return json({ blocked: left.blockedAccountIds.includes(b) || right.blockedAccountIds.includes(a) });
    }
    if (url.pathname === '/internal/fair-play/block' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const accountId = clean(body.accountId, 80);
      const targetAccountId = clean(body.targetAccountId, 80);
      if (!accountId || !targetAccountId || accountId === targetAccountId) return json({ error: 'Invalid competitive block.' }, 400);
      const record = await this.accountBlocks(accountId);
      record.blockedAccountIds = body.blocked === false
        ? record.blockedAccountIds.filter(id => id !== targetAccountId)
        : [...new Set([...record.blockedAccountIds, targetAccountId])].slice(-MAX_BLOCKS);
      record.updatedAt = Date.now();
      await this.fpInternals().ctx.storage.put(`${BLOCK_PREFIX}${accountId}`, record);
      return json({ ok: true, blocked: body.blocked !== false });
    }
    if (url.pathname === '/internal/fair-play/report' && request.method === 'POST') return this.report(request);
    if (url.pathname === '/internal/fair-play/behavior' && request.method === 'POST') {
      const event = await request.json().catch(() => null) as BehaviorEvent | null;
      return event ? this.behavior(event) : json({ error: 'Invalid behavior event.' }, 400);
    }

    if (url.pathname === '/internal/game-complete' && request.method === 'POST') {
      const evidence = await request.clone().json().catch(() => null) as IntegrityGameEvidence | null;
      const response = await super.fetch(request);
      if (evidence?.schema === 'qqurz-integrity-game-v1') {
        await this.fpInternals().ctx.storage.put(`${GAME_INDEX_PREFIX}${evidence.roomCode}`, evidence.gameId);
        const linkedCases = await this.linkSignals(evidence);
        const linkedOpen = linkedCases.find(item => item.status !== 'cleared');
        if (evidence.money && linkedOpen) {
          return json({ gameId: evidence.gameId, disposition: 'manual_review', reviewCaseId: linkedOpen.id, reason: 'Funded settlement is paused for fair-play review.' });
        }
      }
      return response;
    }
    const gameStatus = /^\/internal\/game-status\/(.+)$/.exec(url.pathname);
    if (gameStatus && request.method === 'GET') {
      const base = await super.fetch(request);
      const body = await base.clone().json().catch(() => ({})) as IntegritySettlementDisposition;
      return json(await this.fairPlayDisposition(decodeURIComponent(gameStatus[1]), body));
    }
    const tournamentStatus = /^\/internal\/tournament-status\/(.+)$/.exec(url.pathname);
    if (tournamentStatus && request.method === 'GET') {
      const base = await super.fetch(request);
      const body = await base.clone().json().catch(() => ({})) as { tournamentId?: string; disposition?: string; openCases?: unknown[] };
      const id = decodeURIComponent(tournamentStatus[1]);
      const ids = (await this.fpInternals().ctx.storage.get<string[]>(`${TOURNAMENT_CASE_PREFIX}${id}`)) ?? [];
      const cases = (await Promise.all(ids.map(caseId => this.fpInternals().ctx.storage.get<FairPlayCase>(`${CASE_PREFIX}${caseId}`)))).filter((item): item is FairPlayCase => item !== undefined && item.status !== 'cleared');
      return json({ ...body, tournamentId: id, disposition: cases.length ? 'manual_review' : body.disposition, fairPlayCases: cases.map(item => ({ id: item.id, accountId: item.accountId, status: item.status, priority: item.priority })) });
    }

    if (url.pathname === '/admin/fair-play/reports' && request.method === 'GET') return this.moderatorList(request, 'reports');
    if (url.pathname === '/admin/fair-play/cases' && request.method === 'GET') return this.moderatorList(request, 'cases');
    const playerMatch = /^\/admin\/fair-play\/players\/([^/]+)$/.exec(url.pathname);
    if (playerMatch && request.method === 'GET') return this.moderatorPlayer(request, decodeURIComponent(playerMatch[1]));
    const caseDecision = /^\/admin\/fair-play\/cases\/([^/]+)\/decision$/.exec(url.pathname);
    if (caseDecision && request.method === 'POST') return this.moderatorCaseDecision(request, decodeURIComponent(caseDecision[1]));
    return super.fetch(request);
  }
}

type Color = 'white' | 'black';
type RoomPlayer = { name: string; token: string; accountId: string | null };
type FairPlayRoomInternals = {
  room: {
    code: string;
    createdAt: number;
    lastMoveTiming: { serverCommittedAt: number } | null;
    session: {
      state: string;
      moveNumber: number;
      result: string | null;
      resultKind: string | null;
      winner: Color | null;
      finalizedAt: number | null;
      updatedAt: number;
    };
    players: { white: RoomPlayer; black: RoomPlayer | null };
  } | null;
  ctx: DurableObjectState;
  env: FairPlayEnv;
};
const ROOM_BEHAVIOR_SENT = 'fair-play:room-behavior-sent:v1';
const ROOM_ABANDON = 'fair-play:room-abandon:v1';
const ROOM_CONNECTIONS = 'fair-play:room-connection-counts:v1';
const ROOM_TOURNAMENT = 'spectator:view-metadata:v1';
const ROOM_MONEY = 'money-match:v1';

function roomColorForToken(room: NonNullable<FairPlayRoomInternals['room']>, token: string): Color | null {
  if (room.players.white.token === token) return 'white';
  if (room.players.black?.token === token) return 'black';
  return null;
}
function roomPlayerForColor(room: NonNullable<FairPlayRoomInternals['room']>, color: Color): RoomPlayer | null {
  return color === 'white' ? room.players.white : room.players.black;
}

export class FairPlayChessRoom extends IntegrityChessRoom {
  private fpRoom(): FairPlayRoomInternals { return this as unknown as FairPlayRoomInternals; }
  private async ensureAccepted(accountId: string): Promise<Response | null> {
    const status = await fairPlayStatus(this.fpRoom().env, accountId);
    if (!status.configured) return json({ error: 'Competitive fair-play service is not configured.', code: 'FAIR_PLAY_SERVICE_UNAVAILABLE' }, 503);
    if (!status.accepted) return json({ error: 'Accept the current fair-play policy before competitive play.', code: 'FAIR_PLAY_REQUIRED', fairPlayVersion: FAIR_PLAY_POLICY_VERSION }, 428);
    return null;
  }
  private async recordConnect(request: Request): Promise<void> {
    const room = this.fpRoom().room;
    if (!room) return;
    const token = new URL(request.url).searchParams.get('token') ?? '';
    const color = roomColorForToken(room, token);
    const accountId = color ? roomPlayerForColor(room, color)?.accountId : null;
    if (!color || !accountId) return;
    const current = (await this.fpRoom().ctx.storage.get<Record<string, number>>(ROOM_CONNECTIONS)) ?? {};
    current[accountId] = Math.min(100, (current[accountId] ?? 0) + 1);
    await this.fpRoom().ctx.storage.put(ROOM_CONNECTIONS, current);
  }
  private async sendBehaviorIfTerminal(): Promise<void> {
    const internal = this.fpRoom();
    const room = internal.room;
    if (!room?.session.result || !room.players.black) return;
    if (await internal.ctx.storage.get<boolean>(ROOM_BEHAVIOR_SENT)) return;
    const tournament = (await internal.ctx.storage.get<{ tournamentId?: string | null }>(ROOM_TOURNAMENT)) ?? null;
    const money = (await internal.ctx.storage.get<{ stakeCents?: number }>(ROOM_MONEY)) ?? null;
    const abandonAccountId = (await internal.ctx.storage.get<string>(ROOM_ABANDON)) ?? null;
    const reconnectCounts = (await internal.ctx.storage.get<Record<string, number>>(ROOM_CONNECTIONS)) ?? {};
    const finalizedAt = room.session.finalizedAt ?? room.session.updatedAt ?? Date.now();
    const winner = room.session.winner ? roomPlayerForColor(room, room.session.winner) : null;
    const loserColor = room.session.winner ? (room.session.winner === 'white' ? 'black' : 'white') : null;
    const loser = loserColor ? roomPlayerForColor(room, loserColor) : null;
    const lastMoveAt = room.lastMoveTiming?.serverCommittedAt ?? room.createdAt;
    const reconnectsByAccount: Record<string, number> = {};
    for (const player of [room.players.white, room.players.black]) if (player.accountId) reconnectsByAccount[player.accountId] = Math.max(0, (reconnectCounts[player.accountId] ?? 1) - 1);
    const event: BehaviorEvent = {
      schema: 'qqurz-fair-play-behavior-v1',
      gameId: `room:${room.code}:${room.createdAt}`,
      roomCode: room.code,
      tournamentId: tournament?.tournamentId ?? null,
      money: Boolean(money?.stakeCents),
      finalizedAt,
      resultKind: room.session.resultKind,
      moveCount: room.session.moveNumber,
      winnerAccountId: winner?.accountId ?? null,
      loserAccountId: loser?.accountId ?? null,
      explicitAbandonAccountId: abandonAccountId,
      finalIdleMs: Math.max(0, finalizedAt - lastMoveAt),
      reconnectsByAccount,
      players: [
        { accountId: room.players.white.accountId, color: 'white' },
        { accountId: room.players.black.accountId, color: 'black' },
      ],
    };
    await submitBehaviorEvent(internal.env, event);
    await internal.ctx.storage.put(ROOM_BEHAVIOR_SENT, true);
  }
  private async reportFromSocket(ws: WebSocket, body: Record<string, unknown>): Promise<void> {
    const room = this.fpRoom().room;
    if (!room?.players.black) return;
    const token = (ws.deserializeAttachment() as { token?: string } | null)?.token ?? '';
    const color = roomColorForToken(room, token);
    if (!color) return;
    const reporter = roomPlayerForColor(room, color);
    const target = roomPlayerForColor(room, color === 'white' ? 'black' : 'white');
    if (!reporter?.accountId || !target?.accountId) {
      try { ws.send(JSON.stringify({ type: 'fair_play_error', message: 'Reports require both players to be signed in.' })); } catch { /* closing */ }
      return;
    }
    const reason = validReason(body.reason) ? body.reason : 'other';
    const tournament = (await this.fpRoom().ctx.storage.get<{ tournamentId?: string | null }>(ROOM_TOURNAMENT)) ?? null;
    const money = (await this.fpRoom().ctx.storage.get<{ stakeCents?: number }>(ROOM_MONEY)) ?? null;
    const result = await submitFairPlayReport(this.fpRoom().env, {
      reporterAccountId: reporter.accountId,
      targetAccountId: target.accountId,
      gameId: `room:${room.code}:${room.createdAt}`,
      roomCode: room.code,
      tournamentId: tournament?.tournamentId ?? null,
      money: Boolean(money?.stakeCents),
      reason,
      details: clean(body.details, 800),
    });
    try { ws.send(JSON.stringify(result.ok ? { type: 'fair_play_reported', reportId: result.reportId } : { type: 'fair_play_error', message: result.error ?? 'Report failed.' })); } catch { /* closing */ }
  }
  private async blockFromSocket(ws: WebSocket, blocked: boolean): Promise<void> {
    const room = this.fpRoom().room;
    if (!room?.players.black) return;
    const token = (ws.deserializeAttachment() as { token?: string } | null)?.token ?? '';
    const color = roomColorForToken(room, token);
    if (!color) return;
    const actor = roomPlayerForColor(room, color);
    const target = roomPlayerForColor(room, color === 'white' ? 'black' : 'white');
    if (!actor?.accountId || !target?.accountId) {
      try { ws.send(JSON.stringify({ type: 'fair_play_error', message: 'Competitive blocking requires both players to be signed in.' })); } catch { /* closing */ }
      return;
    }
    const result = await setCompetitiveBlock(this.fpRoom().env, actor.accountId, target.accountId, blocked);
    try { ws.send(JSON.stringify(result.ok ? { type: 'fair_play_blocked', blocked } : { type: 'fair_play_error', message: result.error ?? 'Block update failed.' })); } catch { /* closing */ }
  }
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const internalCreate = url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST';
    const internalJoin = url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST';
    if (internalCreate || internalJoin) {
      const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
      const accountId = clean(body.accountId, 80);
      if (accountId) {
        const denied = await this.ensureAccepted(accountId);
        if (denied) return denied;
        const creatorAccountId = this.fpRoom().room?.players.white.accountId ?? null;
        if (internalJoin && creatorAccountId && await areCompetitivelyBlocked(this.fpRoom().env, accountId, creatorAccountId)) {
          return json({ error: 'This competitive pairing is blocked by one of the players.', code: 'PLAYER_BLOCKED' }, 403);
        }
      }
    }
    const upgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    const response = await super.fetch(request);
    if (upgrade && response.status === 101) await this.recordConnect(request);
    return response;
  }
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as Record<string, unknown>; } catch { /* base handles malformed input */ }
    if (body?.type === 'report_player') return this.reportFromSocket(ws, body);
    if (body?.type === 'block_player') return this.blockFromSocket(ws, true);
    if (body?.type === 'unblock_player') return this.blockFromSocket(ws, false);
    if (body?.type === 'abandon') {
      const room = this.fpRoom().room;
      const token = (ws.deserializeAttachment() as { token?: string } | null)?.token ?? '';
      const color = room ? roomColorForToken(room, token) : null;
      const player = room && color ? roomPlayerForColor(room, color) : null;
      if (player?.accountId) await this.fpRoom().ctx.storage.put(ROOM_ABANDON, player.accountId);
      await super.webSocketMessage(ws, JSON.stringify({ type: 'resign' }));
      await this.sendBehaviorIfTerminal();
      return;
    }
    await super.webSocketMessage(ws, message);
    await this.sendBehaviorIfTerminal();
  }
  override async alarm(): Promise<void> {
    await super.alarm();
    await this.sendBehaviorIfTerminal();
  }
}

export async function handleFairPlayAdminRequest(request: Request, env: IntegrityEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/integrity/admin/fair-play/')) return null;
  const target = registry(env);
  if (!target) return json({ error: 'Fair-play review service is not configured.' }, 503);
  const headers = new Headers(request.headers);
  headers.set('x-integrity-admin', request.headers.get('x-integrity-admin') ?? '');
  return target.fetch(new Request(`https://integrity.internal${url.pathname.replace('/integrity', '')}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  }));
}
