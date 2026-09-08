import { DurableObject } from 'cloudflare:workers';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { chess960Fen, randomChess960Id } from './chess960';

type Color = 'white' | 'black';
type CoinFace = 'heads' | 'tails';
type RoomStatus = 'waiting' | 'coin' | 'strategy' | 'playing' | 'ended';
type PlayerSeat = { name: string; token: string };
type PaidBid = { cents: number; paidAt: number; sessionId: string };
type CoinState = { claimedFace: CoinFace | null; claimedByToken: string | null; result: CoinFace | null; winnerToken: string | null; flippedAt: number | null; endsAt: number | null };
type AuctionState = { bids: Record<string, PaidBid>; leaderToken: string | null; leadingBidCents: number; rerollCount: number; usedSessions: string[] };
type RoomState = {
  code: string;
  status: RoomStatus;
  positionId: number;
  fen: string;
  turn: Color;
  pendingClockPress: Color | null;
  whiteClockMs: number;
  blackClockMs: number;
  turnStartedAt: number | null;
  strategyEndsAt: number | null;
  moves: string[];
  result: string | null;
  check: boolean;
  checkmate: boolean;
  createdAt: number;
  lastActivityAt: number;
  players: { white: PlayerSeat; black: PlayerSeat | null };
  coin: CoinState;
  auction: AuctionState;
};
type SocketAttachment = { token: string };
type ClientMessage =
  | { type: 'move'; uci: string }
  | { type: 'clock_slap' }
  | { type: 'start_now' }
  | { type: 'call_coin'; face: CoinFace }
  | { type: 'claim_position_bid'; sessionId: string }
  | { type: 'resign' };
type Env = {
  ROOMS: DurableObjectNamespace<ChessRoom>;
  ALLOWED_ORIGINS?: string;
  STRIPE_SECRET_KEY?: string;
  PAYMENTS_MODE?: string;
  LIVE_POSITION_BIDS?: string;
};

const GAME_CLOCK_MS = 10 * 60 * 1000;
const STRATEGY_MS = 2 * 60 * 1000;
const COIN_SHOW_MS = 2800;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BID_VALUES = new Set([200, 500]);

function emptyCoin(): CoinState { return { claimedFace: null, claimedByToken: null, result: null, winnerToken: null, flippedAt: null, endsAt: null }; }
function emptyAuction(): AuctionState { return { bids: {}, leaderToken: null, leadingBidCents: 0, rerollCount: 0, usedSessions: [] }; }
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
function resultText(position: Chess): string | null {
  if (position.isCheckmate()) return position.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (position.isStalemate()) return 'Draw by stalemate';
  if (position.isInsufficientMaterial()) return 'Draw by insufficient material';
  return position.isEnd() ? 'Game over' : null;
}
function activeClockColor(room: RoomState): Color | null { return room.status === 'playing' ? room.pendingClockPress ?? room.turn : null; }
function remainingFor(room: RoomState, color: Color, at = Date.now()): number {
  const stored = color === 'white' ? room.whiteClockMs : room.blackClockMs;
  return activeClockColor(room) === color && room.turnStartedAt !== null ? Math.max(0, stored - Math.max(0, at - room.turnStartedAt)) : Math.max(0, stored);
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
  return {
    code: room.code, status: room.status, positionId: room.positionId, fen: room.fen, turn: room.turn,
    activeClock: activeClockColor(room), awaitingClockPress: room.pendingClockPress,
    whiteClockMs: remainingFor(room, 'white', now), blackClockMs: remainingFor(room, 'black', now),
    turnStartedAt: room.turnStartedAt, strategyEndsAt: room.strategyEndsAt, serverNow: now,
    moves: room.moves, result: room.result, check: room.check, checkmate: room.checkmate, yourColor: viewerColor,
    players: {
      white: { name: room.players.white.name, connected: connected.has('white') },
      black: room.players.black ? { name: room.players.black.name, connected: connected.has('black') } : null,
    },
    coin: { claimedFace: room.coin.claimedFace, claimedBy, result: room.coin.result, winner, flippedAt: room.coin.flippedAt, endsAt: room.coin.endsAt, yourFace },
    auction: {
      leadingBidCents: room.auction.leadingBidCents,
      leaderName: room.auction.leaderToken ? playerForToken(room, room.auction.leaderToken)?.name ?? null : null,
      rerollCount: room.auction.rerollCount,
      yourBidCents: viewerToken ? room.auction.bids[viewerToken]?.cents ?? 0 : 0,
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
        const internal = await stub.fetch(new Request('https://room.internal/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name }) }));
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get<RoomState>('room')) ?? null;
      if (this.room) {
        if (!this.room.coin) this.room.coin = emptyCoin();
        if (!this.room.auction) this.room.auction = emptyAuction();
        if (this.room.pendingClockPress === undefined) this.room.pendingClockPress = null;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);
      const body = await request.json() as { code?: string; name?: string };
      const code = String(body.code ?? '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: 'Invalid room code.' }, 400);
      const now = Date.now(), token = seatToken(), positionId = randomChess960Id();
      this.room = {
        code, status: 'waiting', positionId, fen: chess960Fen(positionId), turn: 'white', pendingClockPress: null,
        whiteClockMs: GAME_CLOCK_MS, blackClockMs: GAME_CLOCK_MS, turnStartedAt: null, strategyEndsAt: null,
        moves: [], result: null, check: false, checkmate: false, createdAt: now, lastActivityAt: now,
        players: { white: { name: normalizeName(body.name), token }, black: null }, coin: emptyCoin(), auction: emptyAuction(),
      };
      await this.persist();
      return json({ code, token, color: 'white' });
    }

    if (url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST') {
      if (!this.room) return json({ error: 'That room does not exist.' }, 404);
      if (this.room.players.black) return json({ error: 'That room already has two players.' }, 409);
      if (this.room.status === 'ended') return json({ error: 'That room has already ended.' }, 409);
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
      this.ctx.acceptWebSocket(server); server.serializeAttachment({ token } satisfies SocketAttachment); this.sendSnapshot(server, token); queueMicrotask(() => this.broadcast());
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

    if (payload.type === 'call_coin') return void await this.callCoin(ws, attachment.token, payload.face);
    if (payload.type === 'claim_position_bid') return void await this.claimPositionBid(ws, attachment.token, payload.sessionId);
    if (payload.type === 'move') return void await this.handleMove(ws, color, payload.uci);
    if (payload.type === 'clock_slap') return void await this.handleClockSlap(ws, color);
    if (payload.type === 'start_now') {
      if (this.room.status !== 'strategy' || !this.room.players.black) return this.sendError(ws, 'The game cannot start yet.');
      this.startPlaying(Date.now()); await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (payload.type === 'resign') {
      if (this.room.status !== 'playing') return this.sendError(ws, 'There is no active game to resign.');
      this.settleActiveClock(Date.now()); this.room.status = 'ended'; this.room.result = `${color === 'white' ? 'Black' : 'White'} wins by resignation`;
      this.room.pendingClockPress = null; this.room.turnStartedAt = null; this.room.lastActivityAt = Date.now();
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.sendError(ws, 'Unknown command.');
  }

  async webSocketClose(): Promise<void> { this.broadcast(); }
  async webSocketError(): Promise<void> { this.broadcast(); }

  async alarm(): Promise<void> {
    if (!this.room) return; const now = Date.now();
    if (this.room.status === 'coin' && this.room.coin.result && (this.room.coin.endsAt ?? 0) <= now) {
      this.room.status = 'strategy'; this.room.strategyEndsAt = now + STRATEGY_MS; this.room.coin.endsAt = null; this.room.lastActivityAt = now;
      await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (this.room.status === 'strategy') {
      if ((this.room.strategyEndsAt ?? 0) <= now) { this.startPlaying(now); await this.persist(); this.broadcast(); }
      await this.scheduleForState(); return;
    }
    if (this.room.status === 'playing') {
      const owner = activeClockColor(this.room); this.settleActiveClock(now);
      const remaining = owner === 'white' ? this.room.whiteClockMs : this.room.blackClockMs;
      if (owner && remaining <= 0) {
        this.room.status = 'ended'; this.room.result = `${opposite(owner) === 'white' ? 'White' : 'Black'} wins on time`;
        this.room.pendingClockPress = null; this.room.turnStartedAt = null; this.room.lastActivityAt = now;
        await this.persist(); this.broadcast(); return;
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
  private sendSnapshot(ws: WebSocket, token: string): void { try { ws.send(JSON.stringify({ type: 'snapshot', room: this.snapshotForToken(token) })); } catch { /* socket closing */ } }
  private broadcast(): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) { const attachment = ws.deserializeAttachment() as SocketAttachment | null; if (attachment?.token) this.sendSnapshot(ws, attachment.token); }
  }
  private sendError(ws: WebSocket, message: string): void { try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* socket closing */ } }

  private prepareCoin(now: number): void {
    if (!this.room) return;
    this.room.status = 'coin'; this.room.turnStartedAt = null; this.room.pendingClockPress = null; this.room.strategyEndsAt = null;
    this.room.whiteClockMs = GAME_CLOCK_MS; this.room.blackClockMs = GAME_CLOCK_MS; this.room.moves = []; this.room.result = null;
    this.room.check = false; this.room.checkmate = false; this.room.coin = emptyCoin(); this.room.auction = emptyAuction(); this.room.lastActivityAt = now;
  }

  private async callCoin(ws: WebSocket, token: string, face: CoinFace): Promise<void> {
    if (!this.room || this.room.status !== 'coin' || !this.room.players.black) return this.sendError(ws, 'The coin toss is not available right now.');
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
  private async verifyBidSession(sessionId: string): Promise<{ cents: number }> {
    if (!this.room) throw new Error('Room unavailable.');
    const mode = this.paymentMode();
    if (mode === 'off') throw new Error('Position-bid payments are not configured.');
    if (mode === 'live' && this.env.LIVE_POSITION_BIDS !== 'enabled') throw new Error('Live paid position bidding is disabled. Use test mode until the competitive rules are approved.');
    const pattern = mode === 'live' ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
    if (!pattern.test(sessionId)) throw new Error('Invalid Checkout Session.');
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}` } });
    const payload = await response.json().catch(() => ({})) as { payment_status?: string; metadata?: { kind?: string; room_code?: string; bid_cents?: string }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || 'Could not verify the position bid.');
    const cents = Number(payload.metadata?.bid_cents ?? '0');
    if (payload.payment_status !== 'paid' || payload.metadata?.kind !== 'position_bid' || payload.metadata?.room_code !== this.room.code || !BID_VALUES.has(cents)) throw new Error('This payment does not match a valid QQURZ position bid for this room.');
    return { cents };
  }
  private async claimPositionBid(ws: WebSocket, token: string, rawSessionId: unknown): Promise<void> {
    if (!this.room || (this.room.status !== 'coin' && this.room.status !== 'strategy')) return this.sendError(ws, 'Position bidding closes when play begins.');
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

  private rerollPosition(): void {
    if (!this.room) return; const positionId = randomChess960Id();
    this.room.positionId = positionId; this.room.fen = chess960Fen(positionId); this.room.turn = 'white'; this.room.moves = []; this.room.result = null; this.room.check = false; this.room.checkmate = false;
  }
  private startPlaying(now: number): void {
    if (!this.room) return; this.room.status = 'playing'; this.room.strategyEndsAt = null; this.room.pendingClockPress = null; this.room.turnStartedAt = now; this.room.lastActivityAt = now;
  }
  private settleActiveClock(now: number): void {
    if (!this.room || this.room.status !== 'playing' || this.room.turnStartedAt === null) return;
    const owner = activeClockColor(this.room); if (!owner) return;
    const elapsed = Math.max(0, now - this.room.turnStartedAt);
    if (owner === 'white') this.room.whiteClockMs = Math.max(0, this.room.whiteClockMs - elapsed);
    else this.room.blackClockMs = Math.max(0, this.room.blackClockMs - elapsed);
    this.room.turnStartedAt = now;
  }
  private async handleClockSlap(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.status !== 'playing' || this.room.result) return this.sendError(ws, 'The clock is not accepting presses.');
    if (this.room.pendingClockPress !== color) return this.sendError(ws, 'Make your move before pressing your clock.');
    const now = Date.now(); this.settleActiveClock(now);
    const remaining = color === 'white' ? this.room.whiteClockMs : this.room.blackClockMs;
    if (remaining <= 0) {
      this.room.status = 'ended'; this.room.result = `${opposite(color) === 'white' ? 'White' : 'Black'} wins on time`; this.room.pendingClockPress = null; this.room.turnStartedAt = null; this.room.lastActivityAt = now;
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.room.pendingClockPress = null; this.room.turnStartedAt = now; this.room.lastActivityAt = now;
    await this.persist(); await this.scheduleForState(); this.broadcast();
  }
  private async handleMove(ws: WebSocket, color: Color, rawUci: unknown): Promise<void> {
    if (!this.room) return;
    if (this.room.status !== 'playing' || this.room.result) return this.sendError(ws, 'The game is not accepting moves.');
    if (this.room.turn !== color) return this.sendError(ws, 'It is not your turn.');
    if (this.room.pendingClockPress) return this.sendError(ws, 'The previous move is waiting for a clock press.');
    const now = Date.now(); this.settleActiveClock(now);
    const currentClock = color === 'white' ? this.room.whiteClockMs : this.room.blackClockMs;
    if (currentClock <= 0) {
      this.room.status = 'ended'; this.room.result = `${opposite(color) === 'white' ? 'White' : 'Black'} wins on time`; this.room.pendingClockPress = null; this.room.turnStartedAt = null;
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    const uci = String(rawUci ?? '').trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return this.sendError(ws, 'Invalid move format.');
    let position: Chess;
    try { position = Chess.fromSetup(parseFen(this.room.fen).unwrap()).unwrap(); }
    catch { return this.sendError(ws, 'The server could not read the room position.'); }
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) { this.room.turnStartedAt = now; await this.persist(); await this.scheduleForState(); return this.sendError(ws, 'That move is not legal.'); }
    const san = makeSan(position, move); position.play(move);
    this.room.fen = makeFen(position.toSetup()); this.room.turn = position.turn; this.room.moves = [...this.room.moves, san].slice(-400);
    this.room.check = position.isCheck(); this.room.checkmate = position.isCheckmate(); this.room.lastActivityAt = now;
    const ending = resultText(position);
    if (ending) {
      this.room.status = 'ended'; this.room.result = ending; this.room.pendingClockPress = null; this.room.turnStartedAt = null; await this.ctx.storage.deleteAlarm();
    } else {
      this.room.pendingClockPress = color; this.room.turnStartedAt = now;
    }
    await this.persist(); await this.scheduleForState(); this.broadcast();
  }

  private async persist(): Promise<void> { if (this.room) await this.ctx.storage.put('room', this.room); }
  private async scheduleForState(): Promise<void> {
    if (!this.room) return;
    if (this.room.status === 'coin' && this.room.coin.endsAt) { await this.ctx.storage.setAlarm(this.room.coin.endsAt); return; }
    if (this.room.status === 'strategy' && this.room.strategyEndsAt) { await this.ctx.storage.setAlarm(this.room.strategyEndsAt); return; }
    if (this.room.status === 'playing' && this.room.turnStartedAt !== null) {
      const owner = activeClockColor(this.room); if (!owner) return;
      const remaining = owner === 'white' ? this.room.whiteClockMs : this.room.blackClockMs;
      await this.ctx.storage.setAlarm(Date.now() + Math.max(1, remaining)); return;
    }
    await this.ctx.storage.deleteAlarm();
  }
}
