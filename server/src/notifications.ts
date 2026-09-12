import { DurableObject } from 'cloudflare:workers';
import { centsToUsdDecimal } from '../../shared/money';
import { AccountRegistry, resolveAccountSession, type AccountEnv } from './accounts';
import { FairPlayActionChessRoom } from './fairPlayRoomApi';
import { MoneyTournamentRegistry } from './moneyTournamentRegistry';
import { CompetitionPaymentLedger } from './competitionPaymentLedger';
import type { EnginePairing, EngineTournament, Participant } from './tournamentEngineTypes';

export type NotificationKind =
  | 'tournament_starting'
  | 'round_ready'
  | 'friend_challenge'
  | 'color_bid_result'
  | 'color_bid_refund'
  | 'payout'
  | 'security';

export type NotificationPreference = 'gameInvites' | 'tournamentUpdates' | 'results' | 'always';
export type NotificationAction =
  | { type: 'room'; roomCode: string }
  | { type: 'tournament'; tournamentId: string }
  | { type: 'account' }
  | null;

export type InAppNotification = {
  id: string;
  accountId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
  priority: 'normal' | 'important' | 'security';
  action: NotificationAction;
  dedupeKey: string;
  metadata: Record<string, string>;
};

type NotificationProfile = {
  id: string;
  username: string;
  displayName: string;
  privacy: { allowChallenges?: boolean };
  notifications: { gameInvites?: boolean; tournamentUpdates?: boolean; results?: boolean; productUpdates?: boolean };
  blockedPlayerIds: string[];
};

export type EmitNotificationInput = {
  accountId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  preference?: NotificationPreference;
  priority?: InAppNotification['priority'];
  action?: NotificationAction;
  dedupeKey: string;
  metadata?: Record<string, string>;
};

export type NotificationEnv = AccountEnv & {
  NOTIFICATIONS: DurableObjectNamespace<NotificationRegistry>;
};

type NotificationRuntimeEnv = NotificationEnv & Record<string, unknown>;

const MAX_PER_ACCOUNT = 250;
const INDEX_PREFIX = 'notifications:index:v1:';
const ITEM_PREFIX = 'notifications:item:v1:';
const DEDUPE_PREFIX = 'notifications:dedupe:v1:';
const TOURNAMENT_KEY = 'engine:tournament:v1:';
const TOURNAMENT_INDEX = 'engine:tournament-index:v1';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function clean(value: unknown, max = 240): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function cleanMetadata(value: Record<string, string> | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, raw]) => [clean(key, 48), clean(raw, 240)]).filter(([key]) => Boolean(key)));
}
function notificationStub(env: NotificationEnv): DurableObjectStub<NotificationRegistry> {
  return env.NOTIFICATIONS.get(env.NOTIFICATIONS.idFromName('qqurz-notification-registry-v1'));
}
function accountStub(env: AccountEnv): DurableObjectStub {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('qqurz-global-account-registry-v1'));
}
async function notificationProfile(env: AccountEnv, selector: { accountId?: string; username?: string }): Promise<NotificationProfile | null> {
  const url = new URL('https://accounts.internal/internal/notification-profile');
  if (selector.accountId) url.searchParams.set('accountId', selector.accountId);
  if (selector.username) url.searchParams.set('username', selector.username);
  const response = await accountStub(env).fetch(new Request(url));
  if (!response.ok) return null;
  return response.json() as Promise<NotificationProfile>;
}
function preferenceForKind(kind: NotificationKind): NotificationPreference {
  if (kind === 'friend_challenge') return 'gameInvites';
  if (kind === 'tournament_starting' || kind === 'round_ready') return 'tournamentUpdates';
  if (kind === 'color_bid_result' || kind === 'color_bid_refund' || kind === 'payout') return 'results';
  return 'always';
}

export async function emitNotification(env: NotificationEnv, input: EmitNotificationInput): Promise<boolean> {
  const accountId = clean(input.accountId, 80);
  const dedupeKey = clean(input.dedupeKey, 180);
  if (!accountId || !dedupeKey) return false;
  const preference = input.preference ?? preferenceForKind(input.kind);
  if (preference !== 'always') {
    const profile = await notificationProfile(env, { accountId });
    if (!profile) return false;
    if (profile.notifications?.[preference] === false) return false;
  }
  const response = await notificationStub(env).fetch(new Request('https://notifications.internal/internal/emit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...input,
      accountId,
      title: clean(input.title, 100),
      body: clean(input.body, 500),
      dedupeKey,
      preference,
      metadata: cleanMetadata(input.metadata),
    }),
  }));
  return response.ok;
}

export class NotificationRegistry extends DurableObject<NotificationEnv> {
  private async emit(body: Record<string, unknown>): Promise<Response> {
    const accountId = clean(body.accountId, 80);
    const dedupeKey = clean(body.dedupeKey, 180);
    const kind = clean(body.kind, 40) as NotificationKind;
    const allowedKinds = new Set<NotificationKind>(['tournament_starting', 'round_ready', 'friend_challenge', 'color_bid_result', 'color_bid_refund', 'payout', 'security']);
    if (!accountId || !dedupeKey || !allowedKinds.has(kind)) return json({ error: 'Invalid notification.' }, 400);
    const dedupeStorageKey = `${DEDUPE_PREFIX}${accountId}:${dedupeKey}`;
    const existingId = await this.ctx.storage.get<string>(dedupeStorageKey);
    if (existingId) {
      const existing = await this.ctx.storage.get<InAppNotification>(`${ITEM_PREFIX}${existingId}`);
      return json({ notification: existing ?? null, duplicate: true });
    }
    const id = `ntf_${crypto.randomUUID().replaceAll('-', '')}`;
    const notification: InAppNotification = {
      id,
      accountId,
      kind,
      title: clean(body.title, 100) || 'QQURZ update',
      body: clean(body.body, 500),
      createdAt: Date.now(),
      readAt: null,
      priority: body.priority === 'important' || body.priority === 'security' ? body.priority : 'normal',
      action: body.action && typeof body.action === 'object' ? body.action as NotificationAction : null,
      dedupeKey,
      metadata: body.metadata && typeof body.metadata === 'object' ? cleanMetadata(body.metadata as Record<string, string>) : {},
    };
    const indexKey = `${INDEX_PREFIX}${accountId}`;
    const index = (await this.ctx.storage.get<string[]>(indexKey)) ?? [];
    const next = [id, ...index.filter(value => value !== id)].slice(0, MAX_PER_ACCOUNT);
    const removed = index.filter(value => !next.includes(value));
    await this.ctx.storage.put({ [indexKey]: next, [`${ITEM_PREFIX}${id}`]: notification, [dedupeStorageKey]: id });
    if (removed.length) await this.ctx.storage.delete(removed.map(value => `${ITEM_PREFIX}${value}`));
    return json({ notification, duplicate: false }, 201);
  }

  private async list(accountId: string): Promise<Response> {
    const ids = (await this.ctx.storage.get<string[]>(`${INDEX_PREFIX}${accountId}`)) ?? [];
    const items = (await Promise.all(ids.map(id => this.ctx.storage.get<InAppNotification>(`${ITEM_PREFIX}${id}`))))
      .filter((item): item is InAppNotification => Boolean(item));
    return json({ notifications: items, unread: items.filter(item => item.readAt === null).length, serverNow: Date.now() });
  }

  private async markRead(accountId: string, id: string): Promise<Response> {
    const key = `${ITEM_PREFIX}${id}`;
    const item = await this.ctx.storage.get<InAppNotification>(key);
    if (!item || item.accountId !== accountId) return json({ error: 'Notification not found.' }, 404);
    if (item.readAt === null) {
      item.readAt = Date.now();
      await this.ctx.storage.put(key, item);
    }
    return json({ notification: item });
  }

  private async markAllRead(accountId: string): Promise<Response> {
    const ids = (await this.ctx.storage.get<string[]>(`${INDEX_PREFIX}${accountId}`)) ?? [];
    const now = Date.now();
    let changed = 0;
    for (const id of ids) {
      const key = `${ITEM_PREFIX}${id}`;
      const item = await this.ctx.storage.get<InAppNotification>(key);
      if (!item || item.accountId !== accountId || item.readAt !== null) continue;
      item.readAt = now;
      await this.ctx.storage.put(key, item);
      changed += 1;
    }
    return json({ ok: true, changed });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/emit' && request.method === 'POST') return this.emit(await request.json().catch(() => ({})) as Record<string, unknown>);
    if (url.pathname === '/internal/list' && request.method === 'GET') return this.list(clean(url.searchParams.get('accountId'), 80));
    if (url.pathname === '/internal/read' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      return this.markRead(clean(body.accountId, 80), clean(body.id, 80));
    }
    if (url.pathname === '/internal/read-all' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      return this.markAllRead(clean(body.accountId, 80));
    }
    return json({ error: 'Notification registry route not found.' }, 404);
  }
}

export async function handleNotificationRequest(request: Request, env: NotificationEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/notifications')) return null;
  const identity = await resolveAccountSession(request, env);
  if (!identity) return json({ error: 'Sign in to use notifications.' }, 401);
  const stub = notificationStub(env);

  if (url.pathname === '/notifications' && request.method === 'GET') {
    return stub.fetch(new Request(`https://notifications.internal/internal/list?accountId=${encodeURIComponent(identity.id)}`));
  }
  if (url.pathname === '/notifications/read-all' && request.method === 'POST') {
    return stub.fetch(new Request('https://notifications.internal/internal/read-all', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: identity.id }),
    }));
  }
  const readMatch = /^\/notifications\/([^/]+)\/read$/.exec(url.pathname);
  if (readMatch && request.method === 'POST') {
    return stub.fetch(new Request('https://notifications.internal/internal/read', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: identity.id, id: readMatch[1] }),
    }));
  }
  if (url.pathname === '/notifications/challenge' && request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const targetUsername = clean(body.username, 20).replace(/[^A-Za-z0-9_-]/g, '');
    const roomCode = clean(body.roomCode, 6).toUpperCase();
    if (!targetUsername || !/^[A-Z0-9]{6}$/.test(roomCode)) return json({ error: 'Choose a player and a valid room.' }, 400);
    const [target, actor] = await Promise.all([
      notificationProfile(env, { username: targetUsername }),
      notificationProfile(env, { accountId: identity.id }),
    ]);
    if (!target) return json({ error: 'Player not found.' }, 404);
    if (target.id === identity.id) return json({ error: 'You cannot challenge yourself.' }, 400);
    if (target.privacy?.allowChallenges === false) return json({ error: 'That player is not accepting challenges.' }, 403);
    if (target.blockedPlayerIds.includes(identity.id) || actor?.blockedPlayerIds.includes(target.id)) return json({ error: 'This challenge is unavailable.' }, 403);
    const delivered = await emitNotification(env, {
      accountId: target.id,
      kind: 'friend_challenge',
      title: `${identity.displayName} challenged you`,
      body: `Open room ${roomCode} to play a Chess960 friend match.`,
      preference: 'gameInvites',
      priority: 'important',
      action: { type: 'room', roomCode },
      dedupeKey: `challenge:${roomCode}:${identity.id}:${target.id}`,
      metadata: { challengerAccountId: identity.id, challengerName: identity.displayName, roomCode },
    });
    return delivered ? json({ ok: true, target: { username: target.username, displayName: target.displayName } }, 201) : json({ ok: true, delivered: false, reason: 'The player has game invite notifications disabled.' });
  }
  return json({ error: 'Notification route not found.' }, 404);
}

export class NotificationAccountRegistry extends AccountRegistry {
  private notificationInternals(): { ctx: DurableObjectState; env: NotificationRuntimeEnv } {
    return this as unknown as { ctx: DurableObjectState; env: NotificationRuntimeEnv };
  }

  private async profileLookup(url: URL): Promise<Response> {
    const ctx = this.notificationInternals().ctx;
    const accountIdParam = clean(url.searchParams.get('accountId'), 80);
    const username = clean(url.searchParams.get('username'), 20).toLowerCase();
    const accountId = accountIdParam || (username ? (await ctx.storage.get<string>(`username:${username}`)) ?? '' : '');
    if (!accountId) return json({ error: 'Account not found.' }, 404);
    const account = await ctx.storage.get<any>(`account:${accountId}`);
    if (!account) return json({ error: 'Account not found.' }, 404);
    return json({
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      privacy: account.privacy ?? { allowChallenges: true },
      notifications: account.notifications ?? { gameInvites: true, tournamentUpdates: true, results: true, productUpdates: false },
      blockedPlayerIds: Array.isArray(account.blockedPlayerIds) ? account.blockedPlayerIds : [],
    });
  }

  private async actor(request: Request): Promise<{ id: string; displayName: string } | null> {
    const auth = request.headers.get('authorization');
    if (!auth) return null;
    const response = await super.fetch(new Request('https://accounts.internal/internal/resolve', { headers: { authorization: auth, 'user-agent': request.headers.get('user-agent') ?? '' } }));
    if (!response.ok) return null;
    return response.json() as Promise<{ id: string; displayName: string }>;
  }

  private async security(accountId: string, title: string, body: string, dedupeKey: string): Promise<void> {
    const env = this.notificationInternals().env;
    if (!env.NOTIFICATIONS) return;
    await emitNotification(env as NotificationEnv, {
      accountId,
      kind: 'security',
      title,
      body,
      preference: 'always',
      priority: 'security',
      action: { type: 'account' },
      dedupeKey,
    }).catch(() => undefined);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/notification-profile' && request.method === 'GET') return this.profileLookup(url);
    const actor = ['/account/password', '/account/sessions/revoke', '/account/sessions/revoke-others'].includes(url.pathname) ? await this.actor(request) : null;
    const response = await super.fetch(request);
    if (!response.ok) return response;
    const payload = await response.clone().json().catch(() => ({})) as Record<string, any>;
    const ua = request.headers.get('user-agent') ?? '';
    const device = /iphone|ipad/i.test(ua) ? 'iPhone / iPad' : /android/i.test(ua) ? 'Android device' : /macintosh|mac os/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows PC' : 'browser';
    if (url.pathname === '/account/register' && payload.account?.id) await this.security(payload.account.id, 'Account created', 'Your QQURZ account was created and a new session was opened.', `security:register:${payload.account.id}`);
    if (url.pathname === '/account/login' && payload.account?.id) await this.security(payload.account.id, 'New sign-in', `A new QQURZ session signed in from ${device}.`, `security:login:${payload.account.id}:${Date.now()}`);
    if (url.pathname === '/account/verify-email' && payload.account?.id) await this.security(payload.account.id, 'Email verified', 'Your account email was successfully verified.', `security:email-verified:${payload.account.id}`);
    if (url.pathname === '/account/password' && actor) await this.security(actor.id, 'Password changed', 'Your password was changed and other sessions were signed out.', `security:password:${actor.id}:${Date.now()}`);
    if (url.pathname === '/account/sessions/revoke' && actor) await this.security(actor.id, 'Session revoked', 'One of your signed-in sessions was revoked from account settings.', `security:session-revoke:${actor.id}:${Date.now()}`);
    if (url.pathname === '/account/sessions/revoke-others' && actor) await this.security(actor.id, 'Other sessions signed out', 'All other QQURZ sessions were signed out.', `security:session-revoke-others:${actor.id}:${Date.now()}`);
    return response;
  }
}

type NotificationRoomState = {
  code: string;
  players: {
    white: { token: string; accountId: string | null; name: string };
    black: { token: string; accountId: string | null; name: string } | null;
  };
  colorAuction: {
    bids: Record<string, { cents: number; desiredColor: 'white' | 'black'; sessionId: string; refundedAt: number | null }>;
    leaderToken: string | null;
    desiredColor: 'white' | 'black' | null;
    settled: boolean;
  };
};

export class NotifyingChessRoom extends FairPlayActionChessRoom {
  private notificationRoomInternals(): { room: NotificationRoomState | null; env: NotificationRuntimeEnv } {
    return this as unknown as { room: NotificationRoomState | null; env: NotificationRuntimeEnv };
  }
  private playerForToken(room: NotificationRoomState, token: string) {
    if (room.players.white.token === token) return room.players.white;
    if (room.players.black?.token === token) return room.players.black;
    return null;
  }
  private async syncColorBidNotifications(): Promise<void> {
    const { room, env } = this.notificationRoomInternals();
    if (!room || !env.NOTIFICATIONS) return;
    for (const [token, bid] of Object.entries(room.colorAuction.bids)) {
      const player = this.playerForToken(room, token);
      if (!player?.accountId) continue;
      if (bid.refundedAt) await emitNotification(env as NotificationEnv, {
        accountId: player.accountId,
        kind: 'color_bid_refund',
        title: 'Color bid refunded',
        body: `$${centsToUsdDecimal(bid.cents)} was refunded because that color bid is no longer active.`,
        preference: 'results',
        priority: 'important',
        action: { type: 'room', roomCode: room.code },
        dedupeKey: `color-refund:${room.code}:${bid.sessionId}`,
        metadata: { roomCode: room.code, amountCents: String(bid.cents), desiredColor: bid.desiredColor },
      }).catch(() => undefined);
      if (room.colorAuction.settled && room.colorAuction.leaderToken === token && !bid.refundedAt) await emitNotification(env as NotificationEnv, {
        accountId: player.accountId,
        kind: 'color_bid_result',
        title: `${bid.desiredColor === 'white' ? 'White' : 'Black'} secured`,
        body: `Your $${centsToUsdDecimal(bid.cents)} color bid won in room ${room.code}.`,
        preference: 'results',
        priority: 'important',
        action: { type: 'room', roomCode: room.code },
        dedupeKey: `color-result:${room.code}:${bid.sessionId}`,
        metadata: { roomCode: room.code, amountCents: String(bid.cents), desiredColor: bid.desiredColor },
      }).catch(() => undefined);
    }
  }
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await super.webSocketMessage(ws, message);
    await this.syncColorBidNotifications();
  }
  override async alarm(): Promise<void> {
    await super.alarm();
    await this.syncColorBidNotifications();
  }
}

export class NotifyingTournamentRegistry extends MoneyTournamentRegistry {
  private notificationTournamentInternals(): { ctx: DurableObjectState; env: NotificationRuntimeEnv } {
    return this as unknown as { ctx: DurableObjectState; env: NotificationRuntimeEnv };
  }
  private async notificationTournament(id: string): Promise<EngineTournament | null> {
    return (await this.notificationTournamentInternals().ctx.storage.get<EngineTournament>(`${TOURNAMENT_KEY}${id}`)) ?? null;
  }
  private async roundNotice(tournament: EngineTournament, participant: Participant, pairing: EnginePairing, color: 'white' | 'black'): Promise<void> {
    if (!pairing.roomCode) return;
    await emitNotification(this.notificationTournamentInternals().env as NotificationEnv, {
      accountId: participant.accountId,
      kind: 'round_ready',
      title: `Round ${pairing.round} is ready`,
      body: `Board ${pairing.board} in ${tournament.title} is ready. You have ${color === 'white' ? 'White' : 'Black'}.`,
      preference: 'tournamentUpdates',
      priority: 'important',
      action: { type: 'room', roomCode: pairing.roomCode },
      dedupeKey: `round-ready:${tournament.id}:${pairing.id}:${participant.accountId}`,
      metadata: { tournamentId: tournament.id, round: String(pairing.round), board: String(pairing.board), roomCode: pairing.roomCode, color },
    }).catch(() => undefined);
  }
  private async syncTournament(id: string): Promise<void> {
    const tournament = await this.notificationTournament(id);
    const env = this.notificationTournamentInternals().env;
    if (!tournament || !env.NOTIFICATIONS) return;
    const participants = Object.values(tournament.participants).filter(player => player.status !== 'withdrawn');
    if (tournament.startedAt) {
      for (const participant of participants) await emitNotification(env as NotificationEnv, {
        accountId: participant.accountId,
        kind: 'tournament_starting',
        title: `${tournament.title} is starting`,
        body: `Tournament play has started. Round ${Math.max(1, tournament.currentRound)} is being prepared now.`,
        preference: 'tournamentUpdates',
        priority: 'important',
        action: { type: 'tournament', tournamentId: tournament.id },
        dedupeKey: `tournament-start:${tournament.id}:${participant.accountId}`,
        metadata: { tournamentId: tournament.id },
      }).catch(() => undefined);
    }
    if (tournament.status !== 'round_active') return;
    const round = tournament.rounds.find(value => value.number === tournament.currentRound);
    if (!round) return;
    for (const pairing of round.pairings) {
      if (pairing.status !== 'live' || !pairing.roomCode || !pairing.blackId) continue;
      const white = tournament.participants[pairing.whiteId];
      const black = tournament.participants[pairing.blackId];
      if (white) await this.roundNotice(tournament, white, pairing, 'white');
      if (black) await this.roundNotice(tournament, black, pairing, 'black');
    }
  }
  private async syncFromRequest(urlValue: string, method: string, bodyText: string): Promise<void> {
    const url = new URL(urlValue);
    let id = clean(url.searchParams.get('id') ?? url.searchParams.get('tournamentId'), 80);
    if (!id && method === 'POST' && bodyText) {
      try {
        const body = JSON.parse(bodyText) as Record<string, unknown>;
        id = clean(body.id ?? body.tournamentId, 80);
      } catch { /* malformed bodies are handled by the tournament engine */ }
    }
    if (id) await this.syncTournament(id);
  }
  override async fetch(request: Request): Promise<Response> {
    const requestUrl = request.url;
    const requestMethod = request.method;
    const bodyText = requestMethod === 'POST' ? await request.clone().text() : '';
    const response = await super.fetch(request);
    if (response.ok) await this.syncFromRequest(requestUrl, requestMethod, bodyText);
    return response;
  }
  override async alarm(): Promise<void> {
    await super.alarm();
    const ids = (await this.notificationTournamentInternals().ctx.storage.get<string[]>(TOURNAMENT_INDEX)) ?? [];
    for (const id of ids) await this.syncTournament(id);
  }
}

export class NotifyingPaymentLedger extends CompetitionPaymentLedger {
  private notificationPaymentInternals(): { env: NotificationRuntimeEnv } {
    return this as unknown as { env: NotificationRuntimeEnv };
  }
  private async notifyFriendSettlement(payload: Record<string, any>): Promise<void> {
    const winnerAccountId = clean(payload.winnerAccountId, 80);
    const prizeCents = Number(payload.prizeCents);
    const contestId = clean(payload.contestId, 180);
    if (!winnerAccountId || !Number.isSafeInteger(prizeCents) || prizeCents <= 0 || !contestId) return;
    await emitNotification(this.notificationPaymentInternals().env as NotificationEnv, {
      accountId: winnerAccountId,
      kind: 'payout',
      title: 'Match payout received',
      body: `$${centsToUsdDecimal(prizeCents)} was added to your QQURZ wallet.`,
      preference: 'results',
      priority: 'important',
      action: null,
      dedupeKey: `payout:contest:${contestId}:${winnerAccountId}`,
      metadata: { contestId, amountCents: String(prizeCents), source: 'friend_match' },
    }).catch(() => undefined);
  }
  private async notifyTournamentSettlement(payload: Record<string, any>): Promise<void> {
    const settlement = payload.settlement && typeof payload.settlement === 'object' ? payload.settlement as Record<string, any> : null;
    if (!settlement) return;
    const contestId = clean(settlement.contestId, 180);
    const payouts = Array.isArray(settlement.payouts) ? settlement.payouts : [];
    for (const row of payouts) {
      const accountId = clean(row.accountId, 80);
      const amountCents = Number(row.amountCents);
      if (!accountId || !Number.isSafeInteger(amountCents) || amountCents <= 0) continue;
      await emitNotification(this.notificationPaymentInternals().env as NotificationEnv, {
        accountId,
        kind: 'payout',
        title: row.place ? `Tournament payout · place ${row.place}` : 'Tournament payout received',
        body: `$${centsToUsdDecimal(amountCents)} was added to your QQURZ wallet.`,
        preference: 'results',
        priority: 'important',
        action: contestId ? { type: 'tournament', tournamentId: contestId } : null,
        dedupeKey: `payout:tournament:${contestId}:${accountId}`,
        metadata: { tournamentId: contestId, amountCents: String(amountCents), place: String(row.place ?? '') },
      }).catch(() => undefined);
    }
  }
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const response = await super.fetch(request);
    if (!response.ok) return response;
    const payload = await response.clone().json().catch(() => ({})) as Record<string, any>;
    if (url.pathname === '/internal/settle-contest' && request.method === 'POST') await this.notifyFriendSettlement(payload);
    if (url.pathname === '/internal/settle-tournament' && request.method === 'POST') await this.notifyTournamentSettlement(payload);
    return response;
  }
}
