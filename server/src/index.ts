import { DurableObject } from 'cloudflare:workers';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { chess960Fen, randomChess960Id } from './chess960';
import { canColorMove, clockOwner, createGameSession, isTerminalGameState, reduceGameSession, type GameResultKind, type GameSessionModel, type GameSessionState } from '../../shared/gameSession';
import { TOURNAMENT_TIME_TEMPLATES, isTournamentControlAllowed, normalizeTimeControl, type TimeControlRequest, type TournamentTimeTemplateId } from '../../shared/timeControl';

type Color = 'white' | 'black';
type CoinFace = 'heads' | 'tails';
type PlayerSeat = { name: string; token: string };
type PaidBid = { cents: number; paidAt: number; sessionId: string };
type PaidColorBid = { cents: number; desiredColor: Color; paidAt: number; sessionId: string; paymentIntentId: string; refundedAt: number | null };
type CoinState = { claimedFace: CoinFace | null; claimedByToken: string | null; result: CoinFace | null; winnerToken: string | null; flippedAt: number | null; endsAt: number | null };
type AuctionState = { bids: Record<string, PaidBid>; leaderToken: string | null; leadingBidCents: number; rerollCount: number; usedSessions: string[] };
type ColorAuctionState = { bids: Record<string, PaidColorBid>; leaderToken: string | null; leadingBidCents: number; desiredColor: Color | null; usedSessions: string[]; settled: boolean };
type MoveTiming = { moveNumber: number; clientSequence: number | null; clientSentAt: number | null; serverReceivedAt: number; serverCommittedAt: number; chargedElapsedMs: number; latencyCreditMs: number; nextClockStartedAt: number | null };
type LatencyState = { nonce: string | null; sentAt: number; bestRttMs: number | null; sampledAt: number | null };
type RoomState = {
  code: string;
  session: GameSessionModel;
  lastMoveTiming: MoveTiming | null;
  createdAt: number;
  lastActivityAt: number;
  players: { white: PlayerSeat; black: PlayerSeat | null };
  coin: CoinState;
  auction: AuctionState;
  colorAuction: ColorAuctionState;
};
type SocketAttachment = { token: string };
type ClientMessage =
  | { type: 'move'; uci: string; clientSentAt?: number; clientMonotonicMs?: number; clientSequence?: number }
  | { type: 'time_sync_ack'; nonce: string }
  | { type: 'clock_slap' }
  | { type: 'start_now' }
  | { type: 'call_coin'; face: CoinFace }
  | { type: 'claim_position_bid'; sessionId: string }
  | { type: 'claim_color_bid'; sessionId: string }
  | { type: 'settle_color_bid' }
  | { type: 'resign' }
  | { type: 'offer_draw' }
  | { type: 'accept_draw' }
  | { type: 'decline_draw' };
type Env = {
  ROOMS: DurableObjectNamespace<ChessRoom>;
  ALLOWED_ORIGINS?: string;
  STRIPE_SECRET_KEY?: string;
  PAYMENTS_MODE?: string;
  LIVE_POSITION_BIDS?: string;
  LIVE_COLOR_BIDS?: string;
};

const STRATEGY_MS = 2 * 60 * 1000;
const COIN_SHOW_MS = 2800;
const LATENCY_CREDIT_CAP_MS = 75;
const LATENCY_CREDIT_FRACTION = .05;
const LATENCY_SAMPLE_MAX_AGE_MS = 30_000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BID_VALUES = new Set([200, 500]);

function emptyCoin(): CoinState { return { claimedFace: null, claimedByToken: null, result: null, winnerToken: null, flippedAt: null, endsAt: null }; }
function emptyAuction(): AuctionState { return { bids: {}, leaderToken: null, leadingBidCents: 0, rerollCount: 0, usedSessions: [] }; }
function emptyColorAuction(): ColorAuctionState { return { bids: {}, leaderToken: null, leadingBidCents: 0, desiredColor: null, usedSessions: [], settled: false }; }
function legacyState(status: unknown, result: string | null, checkmate: boolean): GameSessionState {
  if (status === 'waiting') return 'LOBBY';
  if (status === 'coin') return 'COIN_TOSS';
  if (status === 'strategy') return 'COUNTDOWN';
  if (status === 'playing') return 'ACTIVE';
  if (checkmate) return 'CHECKMATE';
  if (/resign/i.test(result ?? '')) return 'RESIGN';
  if (/time/i.test(result ?? '')) return 'TIMEOUT';
  if (/draw|stalemate|insufficient/i.test(result ?? '')) return 'DRAW';
  return 'FINAL';
}
function legacyStatus(state: GameSessionState): 'waiting' | 'coin' | 'strategy' | 'playing' | 'ended' {
  if (state === 'LOBBY' || state === 'READY') return 'waiting';
  if (state === 'COLOR_SELECTION' || state === 'COIN_TOSS') return 'coin';
  if (state === 'COUNTDOWN') return 'strategy';
  if (state === 'ACTIVE' || state === 'PAUSED' || state === 'RECONNECTING') return 'playing';
  return 'ended';
}
function inferResultKind(result: string | null, checkmate: boolean): GameSessionModel['resultKind'] {
  if (!result) return null;
  if (checkmate) return 'CHECKMATE';
  if (/resign/i.test(result)) return 'RESIGN';
  if (/time/i.test(result)) return 'TIMEOUT';
  if (/draw|stalemate|insufficient/i.test(result)) return 'DRAW';
  return 'OTHER';
}
function migrateStoredRoom(raw: unknown): RoomState | null {
  if (!raw || typeof raw !== 'object') return null;
  const legacy = raw as Record<string, any>;
  if (legacy.session) return legacy as RoomState;
  if (!legacy.code || !legacy.players?.white) return null;
  const now = Date.now();
  const session = createGameSession({
    id: `room-${legacy.code}`,
    state: legacyState(legacy.status, legacy.result ?? null, Boolean(legacy.checkmate)),
    positionId: Number.isInteger(legacy.positionId) ? legacy.positionId : null,
    fen: typeof legacy.fen === 'string' ? legacy.fen : '',
    sideToMove: legacy.turn === 'black' ? 'black' : 'white',
    whiteClockMs: Number(legacy.whiteClockMs ?? 10 * 60_000),
    blackClockMs: Number(legacy.blackClockMs ?? 10 * 60_000),
    clockMs: Number(legacy.baseClockMs ?? legacy.whiteClockMs ?? 10 * 60_000),
    incrementMs: Number(legacy.incrementMs ?? 0),
    countdownEndsAt: legacy.strategyEndsAt ?? null,
    countdownMs: legacy.strategyEndsAt ? Math.max(0, legacy.strategyEndsAt - now) : 0,
    connectionStatus: 'DISCONNECTED',
    now: Number(legacy.createdAt ?? now),
  });
  session.pendingClockPress = legacy.pendingClockPress === 'white' || legacy.pendingClockPress === 'black' ? legacy.pendingClockPress : null;
  session.movesSan = Array.isArray(legacy.moves) ? legacy.moves.slice(-400) : [];
  session.moveNumber = session.movesSan.length;
  session.result = typeof legacy.result === 'string' ? legacy.result : null;
  session.resultKind = inferResultKind(session.result, Boolean(legacy.checkmate));
  session.check = Boolean(legacy.check);
  session.checkmate = Boolean(legacy.checkmate);
  session.clocks.startedAt = typeof legacy.turnStartedAt === 'number' ? legacy.turnStartedAt : null;
  return {
    code: String(legacy.code), session, lastMoveTiming: legacy.lastMoveTiming ?? null,
    createdAt: Number(legacy.createdAt ?? now), lastActivityAt: Number(legacy.lastActivityAt ?? now),
    players: legacy.players, coin: legacy.coin ?? emptyCoin(), auction: legacy.auction ?? emptyAuction(), colorAuction: legacy.colorAuction ?? emptyColorAuction(),
  };
}
function normalizeName(value: unknown): string {
  const name = String(value ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 28);
  return name || 'Guest';
}
function roomCode(): string {
  const bytes = new Uint8Array(6); crypto.getRandomValues(bytes);
  return [...bytes].map(value => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
}
function seatToken(): string { return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`; }
function randomCoin(): CoinFace { const byte = new Uint8Array(1); crypto.getRandomValues(byte); return byte[0] % 2 === 0 ? 'heads' : 'tails'; }
function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }
function oppositeFace(face: CoinFace): CoinFace { return face === 'heads' ? 'tails' : 'heads'; }
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }); }
function allowedOrigins(env: Env): Set<string> { return new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)); }
function cors(request: Request, response: Response, env: Env): Response {
  const origin = request.headers.get('origin'); const headers = new Headers(response.headers);
  if (origin && allowedOrigins(env).has(origin)) { headers.set('access-control-allow-origin', origin); headers.set('vary', 'Origin'); }
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS'); headers.set('access-control-allow-headers', 'content-type'); headers.set('access-control-max-age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function resultInfo(position: Chess): { kind: GameResultKind; text: string; winner: Color | null } | null {
  if (position.isCheckmate()) {
    const winner: Color = position.turn === 'white' ? 'black' : 'white';
    return { kind: 'CHECKMATE', text: `${winner === 'white' ? 'White' : 'Black'} wins by checkmate`, winner };
  }
  if (position.isStalemate()) return { kind: 'DRAW', text: 'Draw by stalemate', winner: null };
  if (position.isInsufficientMaterial()) return { kind: 'DRAW', text: 'Draw by insufficient material', winner: null };
  return position.isEnd() ? { kind: 'DRAW', text: 'Game over', winner: null } : null;
}
function activeClockColor(room: RoomState): Color | null { return clockOwner(room.session); }
function remainingFor(room: RoomState, color: Color, at = Date.now()): number {
  const stored = color === 'white' ? room.session.clocks.whiteMs : room.session.clocks.blackMs;
  return activeClockColor(room) === color && room.session.clocks.startedAt !== null
    ? Math.max(0, stored - Math.max(0, at - room.session.clocks.startedAt))
    : Math.max(0, stored);
}
function playerForToken(room: RoomState, token: string): PlayerSeat | null {
  if (room.players.white.token === token) return room.players.white;
  if (room.players.black?.token === token) return room.players.black;
  return null;
}
function colorForToken(room: RoomState, token: string): Color | null {
  if (room.players.white.token === token) return 'white';
  if (room.players.black?.token === token) return 'black';
  return null;
}
function makeSnapshot(room: RoomState, connected: Set<Color>, viewerToken: string | null) {
  const now = Date.now();
  const viewerColor = viewerToken ? colorForToken(room, viewerToken) : null;
  const claimedBy = room.coin.claimedByToken ? playerForToken(room, room.coin.claimedByToken)?.name ?? null : null;
  const winner = room.coin.winnerToken ? playerForToken(room, room.coin.winnerToken)?.name ?? null : null;
  const yourFace = viewerToken && room.coin.claimedByToken && room.coin.claimedFace
    ? viewerToken === room.coin.claimedByToken ? room.coin.claimedFace : oppositeFace(room.coin.claimedFace)
    : null;
  const yourColorBid = viewerToken ? room.colorAuction.bids[viewerToken] : undefined;
  const whiteConnected = connected.has('white');
  const blackConnected = connected.has('black');
  const session: GameSessionModel = {
    ...room.session,
    clocks: { ...room.session.clocks, whiteMs: remainingFor(room, 'white', now), blackMs: remainingFor(room, 'black', now) },
    countdownMs: room.session.countdownEndsAt ? Math.max(0, room.session.countdownEndsAt - now) : room.session.countdownMs,
  };
  return {
    code: room.code,
    session,
    status: legacyStatus(session.state), positionId: session.positionId, fen: session.fen, turn: session.sideToMove,
    activeClock: clockOwner(session), awaitingClockPress: session.pendingClockPress,
    whiteClockMs: session.clocks.whiteMs, blackClockMs: session.clocks.blackMs,
    turnStartedAt: session.clocks.startedAt, strategyEndsAt: session.countdownEndsAt, serverNow: now,
    lastMoveTiming: room.lastMoveTiming,
    moves: session.movesSan, result: session.result, check: session.check, checkmate: session.checkmate, yourColor: viewerColor,
    players: {
      white: { name: room.players.white.name, connected: whiteConnected },
      black: room.players.black ? { name: room.players.black.name, connected: blackConnected } : null,
    },
    coin: { claimedFace: room.coin.claimedFace, claimedBy, result: room.coin.result, winner, flippedAt: room.coin.flippedAt, endsAt: room.coin.endsAt, yourFace },
    auction: {
      leadingBidCents: room.auction.leadingBidCents,
      leaderName: room.auction.leaderToken ? playerForToken(room, room.auction.leaderToken)?.name ?? null : null,
      rerollCount: room.auction.rerollCount,
      yourBidCents: viewerToken ? room.auction.bids[viewerToken]?.cents ?? 0 : 0,
    },
    colorAuction: {
      leadingBidCents: room.colorAuction.leadingBidCents,
      leaderName: room.colorAuction.leaderToken ? playerForToken(room, room.colorAuction.leaderToken)?.name ?? null : null,
      desiredColor: room.colorAuction.desiredColor,
      yourBidCents: yourColorBid?.cents ?? 0,
      yourDesiredColor: yourColorBid?.desiredColor ?? null,
      yourBidRefunded: Boolean(yourColorBid?.refundedAt),
    },
  };
}
function parseRoomPath(pathname: string): { code: string; action: 'join' | 'ws' } | null {
  const match = pathname.match(/^\/rooms\/([A-Z0-9]{6})\/(join|ws)$/i);
  return match ? { code: match[1].toUpperCase(), action: match[2].toLowerCase() as 'join' | 'ws' } : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(request, new Response(null, { status: 204 }), env);
    if (request.method === 'GET' && url.pathname === '/health') return cors(request, json({ ok: true, service: 'qqurz-chess-realtime', chess960Positions: 960 }), env);

    if (request.method === 'POST' && url.pathname === '/rooms') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const name = normalizeName(body.name);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const code = roomCode(); const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const internal = await stub.fetch(new Request('https://room.internal/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name, timeControl: body.timeControl, tournamentTemplateId: body.tournamentTemplateId }) }));
        if (internal.status === 409) continue;
        return cors(request, internal, env);
      }
      return cors(request, json({ error: 'Could not allocate a room code. Try again.' }, 503), env);
    }

    const route = parseRoomPath(url.pathname);
    if (!route) return cors(request, json({ error: 'Not found.' }, 404), env);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(route.code));
    if (route.action === 'join' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const internal = await stub.fetch(new Request('https://room.internal/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: normalizeName(body.name) }) }));
      return cors(request, internal, env);
    }
    if (route.action === 'ws' && request.method === 'GET') return stub.fetch(request);
    return cors(request, json({ error: 'Method not allowed.' }, 405), env);
  },
} satisfies ExportedHandler<Env>;

export class ChessRoom extends DurableObject<Env> {
  private room: RoomState | null = null;
  private latency = new Map<string, LatencyState>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.room = migrateStoredRoom(await this.ctx.storage.get<unknown>('room'));
      if (this.room) {
        if (!this.room.coin) this.room.coin = emptyCoin();
        if (!this.room.auction) this.room.auction = emptyAuction();
        if (!this.room.colorAuction) this.room.colorAuction = emptyColorAuction();
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);
      const body = await request.json() as { code?: string; name?: string; timeControl?: TimeControlRequest; tournamentTemplateId?: TournamentTimeTemplateId };
      const code = String(body.code ?? '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: 'Invalid room code.' }, 400);
      const now = Date.now(), token = seatToken(), positionId = randomChess960Id();
      const timeControl = normalizeTimeControl(body.timeControl, '10+5');
      const templateId = body.tournamentTemplateId && TOURNAMENT_TIME_TEMPLATES[body.tournamentTemplateId] ? body.tournamentTemplateId : null;
      if (templateId && !isTournamentControlAllowed(templateId, timeControl)) return json({ error: 'That time control is not allowed by this tournament template.' }, 400);
      this.room = {
        code,
        session: createGameSession({ id: `room-${code}`, state: 'LOBBY', positionId, fen: chess960Fen(positionId), sideToMove: 'white', clockMs: timeControl.baseMs, incrementMs: timeControl.incrementMs, connectionStatus: 'DISCONNECTED', now }),
        lastMoveTiming: null,
        createdAt: now, lastActivityAt: now,
        players: { white: { name: normalizeName(body.name), token }, black: null }, coin: emptyCoin(), auction: emptyAuction(), colorAuction: emptyColorAuction(),
      };
      await this.persist();
      return json({ code, token, color: 'white' });
    }

    if (url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST') {
      if (!this.room) return json({ error: 'That room does not exist.' }, 404);
      if (this.room.players.black) return json({ error: 'That room already has two players.' }, 409);
      if (isTerminalGameState(this.room.session.state)) return json({ error: 'That room has already ended.' }, 409);
      const body = await request.json() as { name?: string }; const token = seatToken();
      this.room.players.black = { name: normalizeName(body.name), token };
      this.prepareCoin(Date.now()); await this.persist(); await this.scheduleForState(); this.broadcast();
      return json({ code: this.room.code, token, color: 'black' });
    }

    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (!this.room) return json({ error: 'That room does not exist.' }, 404);
      const token = url.searchParams.get('token') ?? '';
      if (!colorForToken(this.room, token)) return json({ error: 'Invalid room seat token.' }, 401);
      const pair = new WebSocketPair(); const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server); server.serializeAttachment({ token } satisfies SocketAttachment); await this.syncConnectionState(); this.sendSnapshot(server, token); this.broadcast();
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'Not found.' }, 404);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.room) return this.sendError(ws, 'Room state is unavailable.');
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const color = attachment ? colorForToken(this.room, attachment.token) : null;
    if (!attachment || !color) return this.sendError(ws, 'Your room seat is no longer valid.');
    let payload: ClientMessage;
    try { payload = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as ClientMessage; }
    catch { return this.sendError(ws, 'Unreadable command.'); }

    if (payload.type === 'time_sync_ack') return void this.handleTimeSyncAck(attachment.token, payload.nonce);
    if (payload.type === 'call_coin') return void await this.callCoin(ws, attachment.token, payload.face);
    if (payload.type === 'claim_position_bid') return void await this.claimPositionBid(ws, attachment.token, payload.sessionId);
    if (payload.type === 'claim_color_bid') return void await this.claimColorBid(ws, attachment.token, payload.sessionId);
    if (payload.type === 'settle_color_bid') return void await this.settleColorBid(ws, attachment.token);
    if (payload.type === 'move') return void await this.handleMove(ws, attachment.token, color, payload);
    if (payload.type === 'clock_slap') return void await this.handleClockSlap(ws, attachment.token, color);
    if (payload.type === 'start_now') {
      if (this.room.session.state !== 'COUNTDOWN' || !this.room.players.black) return this.sendError(ws, 'The game cannot start yet.');
      this.startPlaying(Date.now()); await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (payload.type === 'offer_draw') return void await this.handleDrawOffer(ws, color);
    if (payload.type === 'accept_draw') return void await this.handleDrawAccept(ws, color);
    if (payload.type === 'decline_draw') return void await this.handleDrawDecline(ws, color);
    if (payload.type === 'resign') {
      if (!['ACTIVE', 'PAUSED', 'RECONNECTING'].includes(this.room.session.state)) return this.sendError(ws, 'There is no active game to resign.');
      const now = Date.now();
      if (this.room.session.state === 'ACTIVE' || this.room.session.state === 'RECONNECTING') this.settleActiveClock(now);
      if (this.room.session.resultKind === 'TIMEOUT') {
        this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
      }
      this.room.session = reduceGameSession(this.room.session, { type: 'RESIGN', by: color, at: now });
      this.room.lastActivityAt = now;
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.sendError(ws, 'Unknown command.');
  }

  async webSocketClose(): Promise<void> { await this.syncConnectionState(); this.broadcast(); }
  async webSocketError(): Promise<void> { await this.syncConnectionState(); this.broadcast(); }

  async alarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();
    if (this.room.session.state === 'COIN_TOSS' && this.room.coin.result && (this.room.coin.endsAt ?? 0) <= now) {
      this.startStrategy(now); this.room.coin.endsAt = null;
      await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (this.room.session.state === 'COUNTDOWN') {
      if ((this.room.session.countdownEndsAt ?? 0) <= now) this.startPlaying(now);
      await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (this.room.session.state === 'ACTIVE' || this.room.session.state === 'RECONNECTING') {
      this.settleActiveClock(now);
      if (this.room.session.resultKind === 'TIMEOUT') {
        this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
      }
      await this.persist(); await this.scheduleForState(); this.broadcast();
    }
  }

  private connectedColors(): Set<Color> {
    const colors = new Set<Color>(); if (!this.room) return colors;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      const color = attachment ? colorForToken(this.room, attachment.token) : null;
      if (color) colors.add(color);
    }
    return colors;
  }
  private snapshotForToken(token: string | null) { if (!this.room) throw new Error('Room state unavailable.'); return makeSnapshot(this.room, this.connectedColors(), token); }
  private sendSnapshot(ws: WebSocket, token: string): void {
    try { ws.send(JSON.stringify({ type: 'snapshot', room: this.snapshotForToken(token) })); this.sendTimeSync(ws, token); } catch { /* socket closing */ }
  }
  private sendTimeSync(ws: WebSocket, token: string): void {
    const now = Date.now();
    const current = this.latency.get(token);
    if (current?.nonce && now - current.sentAt < 5_000) return;
    if (current?.sampledAt && now - current.sampledAt < 10_000) return;
    const nonce = crypto.randomUUID();
    this.latency.set(token, { nonce, sentAt: now, bestRttMs: current?.bestRttMs ?? null, sampledAt: current?.sampledAt ?? null });
    try { ws.send(JSON.stringify({ type: 'time_sync', nonce, serverSentAt: now })); } catch { /* socket closing */ }
  }
  private handleTimeSyncAck(token: string, nonce: string): void {
    const current = this.latency.get(token);
    if (!current?.nonce || current.nonce !== nonce) return;
    const now = Date.now();
    const rtt = Math.max(0, now - current.sentAt);
    if (rtt > 3_000) { this.latency.set(token, { ...current, nonce: null, sampledAt: now }); return; }
    const bestRttMs = current.bestRttMs === null ? rtt : Math.min(current.bestRttMs, rtt);
    this.latency.set(token, { nonce: null, sentAt: current.sentAt, bestRttMs, sampledAt: now });
  }
  private latencyCreditMs(token: string, rawElapsedMs: number, at: number): number {
    const sample = this.latency.get(token);
    if (!sample || sample.bestRttMs === null || sample.sampledAt === null || at - sample.sampledAt > LATENCY_SAMPLE_MAX_AGE_MS) return 0;
    // Only server-measured RTT is trusted. The small cap and elapsed-time fraction make artificial delayed ACKs unprofitable.
    return Math.max(0, Math.floor(Math.min(LATENCY_CREDIT_CAP_MS, sample.bestRttMs / 4, rawElapsedMs * LATENCY_CREDIT_FRACTION)));
  }
  private broadcast(): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) { const attachment = ws.deserializeAttachment() as SocketAttachment | null; if (attachment?.token) this.sendSnapshot(ws, attachment.token); }
  }
  private sendError(ws: WebSocket, message: string): void { try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* socket closing */ } }

  private prepareCoin(now: number): void {
    if (!this.room) return;
    const current = this.room.session;
    let next = createGameSession({
      id: current.id, state: 'LOBBY', positionId: current.positionId, fen: current.fen, sideToMove: 'white',
      clockMs: current.clocks.baseMs, incrementMs: current.clocks.incrementMs, connectionStatus: 'CONNECTED', now,
    });
    next = reduceGameSession(next, { type: 'TRANSITION', to: 'READY', at: now });
    next = reduceGameSession(next, { type: 'TRANSITION', to: 'COIN_TOSS', at: now });
    this.room.session = next;
    this.room.coin = emptyCoin(); this.room.auction = emptyAuction(); this.room.colorAuction = emptyColorAuction(); this.room.lastActivityAt = now;
  }

  private startStrategy(now: number): void {
    if (!this.room) return;
    this.room.session = reduceGameSession(this.room.session, { type: 'TRANSITION', to: 'COUNTDOWN', at: now });
    this.room.session = reduceGameSession(this.room.session, { type: 'SET_COUNTDOWN', remainingMs: STRATEGY_MS, endsAt: now + STRATEGY_MS, at: now });
    this.room.lastActivityAt = now;
  }

  private async callCoin(ws: WebSocket, token: string, face: CoinFace): Promise<void> {
    if (!this.room || this.room.session.state !== 'COIN_TOSS' || !this.room.players.black) return this.sendError(ws, 'The coin toss is not available right now.');
    if (this.room.colorAuction.leaderToken) return this.sendError(ws, 'A paid color bid is active. Outbid it or let the leader lock the winning side.');
    if (face !== 'heads' && face !== 'tails') return this.sendError(ws, 'Choose Heads or Tails.');
    if (this.room.coin.result || this.room.coin.claimedByToken) return this.sendError(ws, 'Another player already called the coin.');
    this.room.coin.claimedFace = face; this.room.coin.claimedByToken = token;
    const result = randomCoin();
    const otherToken = this.room.players.white.token === token ? this.room.players.black.token : this.room.players.white.token;
    const winnerToken = result === face ? token : otherToken;
    if (this.room.players.white.token !== winnerToken && this.room.players.black) {
      const oldWhite = this.room.players.white; this.room.players.white = this.room.players.black; this.room.players.black = oldWhite;
    }
    const now = Date.now(); this.room.coin.result = result; this.room.coin.winnerToken = winnerToken; this.room.coin.flippedAt = now; this.room.coin.endsAt = now + COIN_SHOW_MS; this.room.lastActivityAt = now;
    await this.persist(); await this.scheduleForState(); this.broadcast();
  }

  private paymentMode(): 'off' | 'test' | 'live' {
    const key = this.env.STRIPE_SECRET_KEY ?? '';
    if (this.env.PAYMENTS_MODE === 'test' && key.startsWith('sk_test_')) return 'test';
    if (this.env.PAYMENTS_MODE === 'live' && key.startsWith('sk_live_')) return 'live';
    return 'off';
  }

  private checkoutPattern(): RegExp {
    return this.paymentMode() === 'live' ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
  }

  private async verifyBidSession(sessionId: string): Promise<{ cents: number }> {
    if (!this.room) throw new Error('Room unavailable.');
    const mode = this.paymentMode();
    if (mode === 'off') throw new Error('Position-bid payments are not configured.');
    if (mode === 'live' && this.env.LIVE_POSITION_BIDS !== 'enabled') throw new Error('Live paid position bidding is disabled. Use test mode until the competitive rules are approved.');
    if (!this.checkoutPattern().test(sessionId)) throw new Error('Invalid Checkout Session.');
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}` } });
    const payload = await response.json().catch(() => ({})) as { payment_status?: string; metadata?: { kind?: string; room_code?: string; bid_cents?: string }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || 'Could not verify the position bid.');
    const cents = Number(payload.metadata?.bid_cents ?? '0');
    if (payload.payment_status !== 'paid' || payload.metadata?.kind !== 'position_bid' || payload.metadata?.room_code !== this.room.code || !BID_VALUES.has(cents)) throw new Error('This payment does not match a valid QQURZ position bid for this room.');
    return { cents };
  }

  private async claimPositionBid(ws: WebSocket, token: string, rawSessionId: unknown): Promise<void> {
    if (!this.room || (this.room.session.state !== 'COIN_TOSS' && this.room.session.state !== 'COUNTDOWN')) return this.sendError(ws, 'Position bidding closes when play begins.');
    const sessionId = String(rawSessionId ?? '').trim();
    if (!sessionId) return this.sendError(ws, 'Missing Checkout Session.');
    if (this.room.auction.usedSessions.includes(sessionId)) return this.sendError(ws, 'That bid payment has already been claimed.');
    try {
      const { cents } = await this.verifyBidSession(sessionId), now = Date.now();
      const previous = this.room.auction.bids[token]?.cents ?? 0;
      if (cents <= previous) return this.sendError(ws, 'Your new bid must be higher than your previous verified bid.');
      this.room.auction.usedSessions = [...this.room.auction.usedSessions, sessionId].slice(-24);
      this.room.auction.bids[token] = { cents, paidAt: now, sessionId };
      if (cents > this.room.auction.leadingBidCents) { this.room.auction.leadingBidCents = cents; this.room.auction.leaderToken = token; this.rerollPosition(); this.room.auction.rerollCount += 1; }
      this.room.lastActivityAt = now; await this.persist(); this.broadcast();
    } catch (error) { this.sendError(ws, error instanceof Error ? error.message : 'Could not verify the paid bid.'); }
  }

  private async verifyColorBidSession(sessionId: string): Promise<{ cents: number; desiredColor: Color; paymentIntentId: string }> {
    if (!this.room) throw new Error('Room unavailable.');
    const mode = this.paymentMode();
    if (mode === 'off') throw new Error('Color-bid payments are not configured.');
    if (mode === 'live' && this.env.LIVE_COLOR_BIDS !== 'enabled') throw new Error('Live paid color bidding is disabled until automatic refunds are enabled by server policy.');
    if (!this.checkoutPattern().test(sessionId)) throw new Error('Invalid Checkout Session.');
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}` } });
    const payload = await response.json().catch(() => ({})) as { payment_status?: string; payment_intent?: string; metadata?: { kind?: string; room_code?: string; bid_cents?: string; desired_color?: string }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || 'Could not verify the color bid.');
    const cents = Number(payload.metadata?.bid_cents ?? '0');
    const desiredColor = payload.metadata?.desired_color === 'white' || payload.metadata?.desired_color === 'black' ? payload.metadata.desired_color : null;
    const paymentIntentId = typeof payload.payment_intent === 'string' ? payload.payment_intent : '';
    if (payload.payment_status !== 'paid' || payload.metadata?.kind !== 'color_bid' || payload.metadata?.room_code !== this.room.code || !BID_VALUES.has(cents) || !desiredColor || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) throw new Error('This payment does not match a valid QQURZ color bid for this room.');
    return { cents, desiredColor, paymentIntentId };
  }

  private async refundColorBid(bid: PaidColorBid, reason: string): Promise<void> {
    if (bid.refundedAt) return;
    const params = new URLSearchParams();
    params.set('payment_intent', bid.paymentIntentId);
    params.set('metadata[qqurz_reason]', reason.slice(0, 120));
    params.set('metadata[room_code]', this.room?.code ?? '');
    const response = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': `qqurz-color-refund-${bid.sessionId}`.slice(0, 255),
      },
      body: params.toString(),
    });
    const payload = await response.json().catch(() => ({})) as { status?: string; error?: { message?: string; code?: string } };
    if (!response.ok && payload.error?.code !== 'charge_already_refunded') throw new Error(payload.error?.message || 'Stripe could not refund the outbid payment.');
    bid.refundedAt = Date.now();
  }

  private async claimColorBid(ws: WebSocket, token: string, rawSessionId: unknown): Promise<void> {
    if (!this.room || this.room.session.state !== 'COIN_TOSS' || !this.room.players.black || this.room.coin.result) return this.sendError(ws, 'Color bidding is only open before the coin toss is resolved.');
    const sessionId = String(rawSessionId ?? '').trim();
    if (!sessionId) return this.sendError(ws, 'Missing color-bid Checkout Session.');
    if (this.room.colorAuction.usedSessions.includes(sessionId)) return this.sendError(ws, 'That color-bid payment has already been claimed.');

    try {
      const verified = await this.verifyColorBidSession(sessionId);
      const now = Date.now();
      const incoming: PaidColorBid = { ...verified, paidAt: now, sessionId, refundedAt: null };
      this.room.colorAuction.usedSessions = [...this.room.colorAuction.usedSessions, sessionId].slice(-32);

      const oldOwn = this.room.colorAuction.bids[token];
      if (oldOwn && !oldOwn.refundedAt && verified.cents <= oldOwn.cents) {
        await this.refundColorBid(incoming, 'bid_not_higher_than_previous');
        this.room.colorAuction.bids[token] = incoming;
        this.room.lastActivityAt = now;
        await this.persist(); this.broadcast();
        return this.sendError(ws, 'That bid did not raise your active bid. The new payment was refunded automatically.');
      }

      const leaderToken = this.room.colorAuction.leaderToken;
      const leaderBid = leaderToken ? this.room.colorAuction.bids[leaderToken] : undefined;
      const beatsLeader = !leaderToken || leaderToken === token || verified.cents > this.room.colorAuction.leadingBidCents;

      if (!beatsLeader) {
        await this.refundColorBid(incoming, 'outbid_on_arrival');
        this.room.colorAuction.bids[token] = incoming;
        this.room.lastActivityAt = now;
        await this.persist(); this.broadcast();
        return this.sendError(ws, `Top color bid is ${this.room.colorAuction.leadingBidCents / 100} USD. Your lower bid was refunded automatically.`);
      }

      // Refund any superseded active payment before installing the new winner.
      if (oldOwn && !oldOwn.refundedAt) await this.refundColorBid(oldOwn, 'superseded_by_higher_own_bid');
      if (leaderToken && leaderToken !== token && leaderBid && !leaderBid.refundedAt) await this.refundColorBid(leaderBid, 'outbid_by_higher_color_bid');

      this.room.colorAuction.bids[token] = incoming;
      this.room.colorAuction.leaderToken = token;
      this.room.colorAuction.leadingBidCents = verified.cents;
      this.room.colorAuction.desiredColor = verified.desiredColor;
      this.room.colorAuction.settled = false;
      this.room.lastActivityAt = now;
      await this.persist(); this.broadcast();
    } catch (error) {
      this.sendError(ws, error instanceof Error ? error.message : 'Could not verify the paid color bid.');
    }
  }

  private assignTokenToColor(token: string, desiredColor: Color): void {
    if (!this.room?.players.black) return;
    const current = colorForToken(this.room, token);
    if (!current || current === desiredColor) return;
    const oldWhite = this.room.players.white;
    this.room.players.white = this.room.players.black;
    this.room.players.black = oldWhite;
  }

  private async settleColorBid(ws: WebSocket, token: string): Promise<void> {
    if (!this.room || this.room.session.state !== 'COIN_TOSS' || this.room.coin.result) return this.sendError(ws, 'The color auction can no longer be settled.');
    if (!this.room.colorAuction.leaderToken || !this.room.colorAuction.desiredColor) return this.sendError(ws, 'There is no winning color bid yet.');
    if (this.room.colorAuction.leaderToken !== token) return this.sendError(ws, 'Only the current high bidder can lock the winning side. You can still outbid them.');
    this.assignTokenToColor(token, this.room.colorAuction.desiredColor);
    this.room.colorAuction.settled = true;
    const now = Date.now(); this.startStrategy(now);
    await this.persist(); await this.scheduleForState(); this.broadcast();
  }

  private rerollPosition(): void {
    if (!this.room) return;
    const positionId = randomChess960Id();
    this.room.session = {
      ...this.room.session,
      positionId, fen: chess960Fen(positionId), sideToMove: 'white', pendingClockPress: null,
      movesSan: [], moveNumber: 0, result: null, resultKind: null, winner: null,
      drawOffers: { white: false, black: false }, resignedBy: null, check: false, checkmate: false,
    };
    this.room.lastMoveTiming = null;
  }
  private startPlaying(now: number): void {
    if (!this.room || this.room.session.state !== 'COUNTDOWN') return;
    this.room.session = reduceGameSession(this.room.session, { type: 'SET_COUNTDOWN', remainingMs: 0, endsAt: null, at: now });
    this.room.session = reduceGameSession(this.room.session, { type: 'TRANSITION', to: 'ACTIVE', at: now });
    this.room.lastActivityAt = now;
  }
  private settleActiveClock(now: number, token?: string): { chargedElapsedMs: number; latencyCreditMs: number } {
    if (!this.room || !['ACTIVE', 'RECONNECTING'].includes(this.room.session.state) || this.room.session.clocks.startedAt === null) return { chargedElapsedMs: 0, latencyCreditMs: 0 };
    const rawElapsedMs = Math.max(0, now - this.room.session.clocks.startedAt);
    if (!rawElapsedMs) return { chargedElapsedMs: 0, latencyCreditMs: 0 };
    const latencyCreditMs = token ? this.latencyCreditMs(token, rawElapsedMs, now) : 0;
    const chargedElapsedMs = Math.max(0, rawElapsedMs - latencyCreditMs);
    this.room.session = reduceGameSession(this.room.session, { type: 'CLOCK_TICK', elapsedMs: chargedElapsedMs, at: now });
    return { chargedElapsedMs, latencyCreditMs };
  }
  private async handleClockSlap(ws: WebSocket, token: string, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE' || this.room.session.result) return this.sendError(ws, 'The clock is not accepting presses.');
    if (this.room.session.pendingClockPress !== color) return this.sendError(ws, 'Make your move before pressing your clock.');
    const now = Date.now(); this.settleActiveClock(now, token);
    if (this.room.session.resultKind === 'TIMEOUT') {
      this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.room.session = reduceGameSession(this.room.session, { type: 'CLOCK_TRANSFERRED', at: now });
    this.room.lastActivityAt = now;
    await this.persist(); await this.scheduleForState(); this.broadcast();
  }
  private async handleDrawOffer(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'Draw offers are only available during active play.');
    const other = opposite(color);
    const now = Date.now();
    if (this.room.session.drawOffers[other]) {
      this.settleActiveClock(now);
      if (this.room.session.resultKind === 'TIMEOUT') {
        this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
      }
      this.room.session = reduceGameSession(this.room.session, { type: 'OFFER_DRAW', by: color, at: now });
      this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null, at: now });
      await this.ctx.storage.deleteAlarm();
    } else {
      this.room.session = reduceGameSession(this.room.session, { type: 'OFFER_DRAW', by: color, at: now });
    }
    this.room.lastActivityAt = now; await this.persist(); this.broadcast();
  }
  private async handleDrawAccept(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'There is no active draw offer.');
    const other = opposite(color);
    if (!this.room.session.drawOffers[other]) return this.sendError(ws, 'Your opponent has not offered a draw.');
    const now = Date.now();
    this.settleActiveClock(now);
    if (this.room.session.resultKind === 'TIMEOUT') {
      this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null, at: now });
    this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast();
  }
  private async handleDrawDecline(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'There is no active draw offer.');
    const other = opposite(color);
    if (!this.room.session.drawOffers[other]) return this.sendError(ws, 'Your opponent has not offered a draw.');
    const now = Date.now();
    this.room.session = reduceGameSession(this.room.session, { type: 'CLEAR_DRAW_OFFER', by: other, at: now });
    this.room.lastActivityAt = now; await this.persist(); this.broadcast();
  }
  private async handleMove(ws: WebSocket, token: string, color: Color, payload: Extract<ClientMessage, { type: 'move' }>): Promise<void> {
    if (!this.room) return;
    if (!canColorMove(this.room.session, color)) return this.sendError(ws, this.room.session.pendingClockPress ? 'The previous move is waiting for a clock press.' : 'The game is not accepting that move.');
    const serverReceivedAt = Date.now();
    const settled = this.settleActiveClock(serverReceivedAt, token);
    if (this.room.session.resultKind === 'TIMEOUT') {
      this.room.lastActivityAt = serverReceivedAt; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    const uci = String(payload.uci ?? '').trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return this.sendError(ws, 'Invalid move format.');
    let position: Chess;
    try { position = Chess.fromSetup(parseFen(this.room.session.fen).unwrap()).unwrap(); }
    catch { return this.sendError(ws, 'The server could not read the room position.'); }
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) { this.room.session.clocks.startedAt = serverReceivedAt; await this.persist(); await this.scheduleForState(); return this.sendError(ws, 'That move is not legal.'); }
    const san = makeSan(position, move); position.play(move);
    this.room.session = reduceGameSession(this.room.session, {
      type: 'MOVE_COMMITTED', fen: makeFen(position.toSetup()), sideToMove: position.turn, mover: color, san,
      check: position.isCheck(), checkmate: position.isCheckmate(), at: serverReceivedAt,
    });
    const serverCommittedAt = Date.now();
    this.room.session.clocks.startedAt = serverCommittedAt;
    const timing: MoveTiming = {
      moveNumber: this.room.session.moveNumber,
      clientSequence: Number.isInteger(payload.clientSequence) ? Number(payload.clientSequence) : null,
      clientSentAt: Number.isFinite(payload.clientSentAt) ? Number(payload.clientSentAt) : null,
      serverReceivedAt,
      serverCommittedAt,
      chargedElapsedMs: settled.chargedElapsedMs,
      latencyCreditMs: settled.latencyCreditMs,
      nextClockStartedAt: this.room.session.clocks.startedAt,
    };
    this.room.lastMoveTiming = timing;
    try { ws.send(JSON.stringify({ type: 'move_ack', timing })); } catch { /* socket closing */ }
    this.room.lastActivityAt = serverCommittedAt;
    const ending = resultInfo(position);
    if (ending) {
      this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', ...ending, at: serverCommittedAt });
      await this.ctx.storage.deleteAlarm();
    }
    await this.persist(); await this.scheduleForState(); this.broadcast();
  }

  private async persist(): Promise<void> { if (this.room) await this.ctx.storage.put('room', this.room); }
  private async syncConnectionState(): Promise<void> {
    if (!this.room) return;
    const connected = this.connectedColors();
    const white = connected.has('white');
    const black = connected.has('black');
    const both = white && Boolean(this.room.players.black) && black;
    const now = Date.now();
    if (this.room.session.state === 'ACTIVE' && !both) {
      this.settleActiveClock(now);
      if (this.room.session.state === 'ACTIVE') this.room.session = reduceGameSession(this.room.session, { type: 'SET_CONNECTION', status: 'RECONNECTING', white, black, at: now });
    } else if (this.room.session.state === 'RECONNECTING' && both) {
      this.settleActiveClock(now);
      if (this.room.session.state === 'RECONNECTING') this.room.session = reduceGameSession(this.room.session, { type: 'SET_CONNECTION', status: 'CONNECTED', white, black, at: now });
    } else {
      const status = both ? 'CONNECTED' : 'DISCONNECTED';
      this.room.session = reduceGameSession(this.room.session, { type: 'SET_CONNECTION', status, white, black, at: now });
    }
    await this.persist(); await this.scheduleForState();
  }
  private async scheduleForState(): Promise<void> {
    if (!this.room) return;
    if (this.room.session.state === 'COIN_TOSS' && this.room.coin.endsAt) { await this.ctx.storage.setAlarm(this.room.coin.endsAt); return; }
    if (this.room.session.state === 'COUNTDOWN' && this.room.session.countdownEndsAt) { await this.ctx.storage.setAlarm(this.room.session.countdownEndsAt); return; }
    if ((this.room.session.state === 'ACTIVE' || this.room.session.state === 'RECONNECTING') && this.room.session.clocks.startedAt !== null) {
      const owner = activeClockColor(this.room); if (!owner) return;
      const remaining = owner === 'white' ? this.room.session.clocks.whiteMs : this.room.session.clocks.blackMs;
      await this.ctx.storage.setAlarm(Date.now() + Math.max(1, remaining)); return;
    }
    await this.ctx.storage.deleteAlarm();
  }
}
