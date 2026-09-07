import { DurableObject } from 'cloudflare:workers';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { chess960Fen, randomChess960Id } from './chess960';

type Color = 'white' | 'black';
type RoomStatus = 'waiting' | 'strategy' | 'playing' | 'ended';

type PlayerSeat = {
  name: string;
  token: string;
};

type RoomState = {
  code: string;
  status: RoomStatus;
  positionId: number;
  fen: string;
  turn: Color;
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
  players: {
    white: PlayerSeat;
    black: PlayerSeat | null;
  };
};

type SocketAttachment = {
  color: Color;
  token: string;
};

type ClientMessage =
  | { type: 'move'; uci: string }
  | { type: 'start_now' }
  | { type: 'choose_pattern' }
  | { type: 'resign' };

type Env = {
  ROOMS: DurableObjectNamespace<ChessRoom>;
  ALLOWED_ORIGINS?: string;
};

const GAME_CLOCK_MS = 10 * 60 * 1000;
const STRATEGY_MS = 2 * 60 * 1000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeName(value: unknown): string {
  const name = String(value ?? 'Guest')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 28);
  return name || 'Guest';
}

function roomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
}

function seatToken(): string {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function allowedOrigins(env: Env): Set<string> {
  const configured = env.ALLOWED_ORIGINS ?? '';
  return new Set(configured.split(',').map(value => value.trim()).filter(Boolean));
}

function cors(request: Request, response: Response, env: Env): Response {
  const origin = request.headers.get('origin');
  const headers = new Headers(response.headers);
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('access-control-max-age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function resultText(position: Chess): string | null {
  if (position.isCheckmate()) return position.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (position.isStalemate()) return 'Draw by stalemate';
  if (position.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (position.isEnd()) return 'Game over';
  return null;
}

function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

function remainingFor(room: RoomState, color: Color, at = Date.now()): number {
  const stored = color === 'white' ? room.whiteClockMs : room.blackClockMs;
  if (room.status !== 'playing' || room.turn !== color || room.turnStartedAt === null) return Math.max(0, stored);
  return Math.max(0, stored - Math.max(0, at - room.turnStartedAt));
}

function makeSnapshot(room: RoomState, connected: Set<Color>) {
  const now = Date.now();
  return {
    code: room.code,
    status: room.status,
    positionId: room.positionId,
    fen: room.fen,
    turn: room.turn,
    whiteClockMs: remainingFor(room, 'white', now),
    blackClockMs: remainingFor(room, 'black', now),
    turnStartedAt: room.turnStartedAt,
    strategyEndsAt: room.strategyEndsAt,
    serverNow: now,
    moves: room.moves,
    result: room.result,
    check: room.check,
    checkmate: room.checkmate,
    players: {
      white: { name: room.players.white.name, connected: connected.has('white') },
      black: room.players.black
        ? { name: room.players.black.name, connected: connected.has('black') }
        : null,
    },
  };
}

function parseRoomPath(pathname: string): { code: string; action: 'join' | 'ws' } | null {
  const match = pathname.match(/^\/rooms\/([A-Z0-9]{6})\/(join|ws)$/i);
  if (!match) return null;
  return { code: match[1].toUpperCase(), action: match[2].toLowerCase() as 'join' | 'ws' };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(request, new Response(null, { status: 204 }), env);

    if (request.method === 'GET' && url.pathname === '/health') {
      return cors(request, json({ ok: true, service: 'qqurz-chess-realtime', paidEntryEnabled: false }), env);
    }

    if (request.method === 'POST' && url.pathname === '/rooms') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const name = normalizeName(body.name);

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const code = roomCode();
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        const internal = await stub.fetch(new Request('https://room.internal/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, name }),
        }));

        if (internal.status === 409) continue;
        return cors(request, internal, env);
      }

      return cors(request, json({ error: 'Could not allocate a room code. Try again.' }, 503), env);
    }

    const route = parseRoomPath(url.pathname);
    if (!route) return cors(request, json({ error: 'Not found.' }, 404), env);

    const id = env.ROOMS.idFromName(route.code);
    const stub = env.ROOMS.get(id);

    if (route.action === 'join' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const internal = await stub.fetch(new Request('https://room.internal/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: normalizeName(body.name) }),
      }));
      return cors(request, internal, env);
    }

    if (route.action === 'ws' && request.method === 'GET') return stub.fetch(request);

    return cors(request, json({ error: 'Method not allowed.' }, 405), env);
  },
} satisfies ExportedHandler<Env>;

export class ChessRoom extends DurableObject {
  private room: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get<RoomState>('room')) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);
      const body = await request.json() as { code?: string; name?: string };
      const code = String(body.code ?? '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: 'Invalid room code.' }, 400);

      const now = Date.now();
      const token = seatToken();
      const positionId = randomChess960Id();
      this.room = {
        code,
        status: 'waiting',
        positionId,
        fen: chess960Fen(positionId),
        turn: 'white',
        whiteClockMs: GAME_CLOCK_MS,
        blackClockMs: GAME_CLOCK_MS,
        turnStartedAt: null,
        strategyEndsAt: null,
        moves: [],
        result: null,
        check: false,
        checkmate: false,
        createdAt: now,
        lastActivityAt: now,
        players: { white: { name: normalizeName(body.name), token }, black: null },
      };
      await this.persist();
      return json({ code, token, color: 'white' });
    }

    if (url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST') {
      if (!this.room) return json({ error: 'That room does not exist.' }, 404);
      if (this.room.players.black) return json({ error: 'That room already has two players.' }, 409);
      if (this.room.status === 'ended') return json({ error: 'That room has already ended.' }, 409);

      const body = await request.json() as { name?: string };
      const token = seatToken();
      this.room.players.black = { name: normalizeName(body.name), token };
      this.resetPosition(Date.now(), true);
      await this.persist();
      await this.scheduleForState();
      this.broadcast();
      return json({ code: this.room.code, token, color: 'black' });
    }

    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      if (!this.room) return json({ error: 'That room does not exist.' }, 404);
      const token = url.searchParams.get('token') ?? '';
      const color = this.colorForToken(token);
      if (!color) return json({ error: 'Invalid room seat token.' }, 401);

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ color, token } satisfies SocketAttachment);
      server.send(JSON.stringify({ type: 'snapshot', room: this.snapshot() }));
      queueMicrotask(() => this.broadcast());
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: 'Not found.' }, 404);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.room) return this.sendError(ws, 'Room state is unavailable.');

    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || this.colorForToken(attachment.token) !== attachment.color) {
      return this.sendError(ws, 'Your room seat is no longer valid.');
    }

    let payload: ClientMessage;
    try {
      payload = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as ClientMessage;
    } catch {
      return this.sendError(ws, 'Unreadable command.');
    }

    if (payload.type === 'move') {
      await this.handleMove(ws, attachment.color, payload.uci);
      return;
    }

    if (payload.type === 'start_now') {
      if (this.room.status !== 'strategy' || !this.room.players.black) {
        return this.sendError(ws, 'The game cannot start yet.');
      }
      this.startPlaying(Date.now());
      await this.persist();
      await this.scheduleForState();
      this.broadcast();
      return;
    }

    if (payload.type === 'choose_pattern') {
      if (attachment.color !== 'white') return this.sendError(ws, 'Only the room creator can choose a new pattern.');
      if (this.room.status === 'playing') return this.sendError(ws, 'The pattern is locked while a game is in progress.');
      this.resetPosition(Date.now(), Boolean(this.room.players.black));
      await this.persist();
      await this.scheduleForState();
      this.broadcast();
      return;
    }

    if (payload.type === 'resign') {
      if (this.room.status !== 'playing') return this.sendError(ws, 'There is no active game to resign.');
      this.settleActiveClock(Date.now());
      this.room.status = 'ended';
      this.room.result = `${attachment.color === 'white' ? 'Black' : 'White'} wins by resignation`;
      this.room.turnStartedAt = null;
      this.room.lastActivityAt = Date.now();
      await this.persist();
      await this.ctx.storage.deleteAlarm();
      this.broadcast();
      return;
    }

    this.sendError(ws, 'Unknown command.');
  }

  async webSocketClose(): Promise<void> {
    this.broadcast();
  }

  async webSocketError(): Promise<void> {
    this.broadcast();
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();

    if (this.room.status === 'strategy') {
      if ((this.room.strategyEndsAt ?? 0) <= now) {
        this.startPlaying(now);
        await this.persist();
        this.broadcast();
      }
      await this.scheduleForState();
      return;
    }

    if (this.room.status === 'playing') {
      this.settleActiveClock(now);
      const remaining = this.room.turn === 'white' ? this.room.whiteClockMs : this.room.blackClockMs;
      if (remaining <= 0) {
        this.room.status = 'ended';
        this.room.result = `${opposite(this.room.turn) === 'white' ? 'White' : 'Black'} wins on time`;
        this.room.turnStartedAt = null;
        this.room.lastActivityAt = now;
        await this.persist();
        this.broadcast();
        return;
      }
      await this.persist();
      await this.scheduleForState();
      this.broadcast();
    }
  }

  private colorForToken(token: string): Color | null {
    if (!this.room || !token) return null;
    if (this.room.players.white.token === token) return 'white';
    if (this.room.players.black?.token === token) return 'black';
    return null;
  }

  private connectedColors(): Set<Color> {
    const colors = new Set<Color>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.color) colors.add(attachment.color);
    }
    return colors;
  }

  private snapshot() {
    if (!this.room) throw new Error('Room state unavailable.');
    return makeSnapshot(this.room, this.connectedColors());
  }

  private broadcast(): void {
    if (!this.room) return;
    const event = JSON.stringify({ type: 'snapshot', room: this.snapshot() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(event);
      } catch {
        // Cloudflare will surface close/error callbacks for dead sockets.
      }
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    try {
      ws.send(JSON.stringify({ type: 'error', message }));
    } catch {
      // Ignore errors from a socket that is already closing.
    }
  }

  private resetPosition(now: number, startStrategy: boolean): void {
    if (!this.room) return;
    const positionId = randomChess960Id();
    this.room.positionId = positionId;
    this.room.fen = chess960Fen(positionId);
    this.room.turn = 'white';
    this.room.whiteClockMs = GAME_CLOCK_MS;
    this.room.blackClockMs = GAME_CLOCK_MS;
    this.room.turnStartedAt = null;
    this.room.strategyEndsAt = startStrategy ? now + STRATEGY_MS : null;
    this.room.status = startStrategy ? 'strategy' : 'waiting';
    this.room.moves = [];
    this.room.result = null;
    this.room.check = false;
    this.room.checkmate = false;
    this.room.lastActivityAt = now;
  }

  private startPlaying(now: number): void {
    if (!this.room) return;
    this.room.status = 'playing';
    this.room.strategyEndsAt = null;
    this.room.turnStartedAt = now;
    this.room.lastActivityAt = now;
  }

  private settleActiveClock(now: number): void {
    if (!this.room || this.room.status !== 'playing' || this.room.turnStartedAt === null) return;
    const elapsed = Math.max(0, now - this.room.turnStartedAt);
    if (this.room.turn === 'white') this.room.whiteClockMs = Math.max(0, this.room.whiteClockMs - elapsed);
    else this.room.blackClockMs = Math.max(0, this.room.blackClockMs - elapsed);
    this.room.turnStartedAt = now;
  }

  private async handleMove(ws: WebSocket, color: Color, rawUci: unknown): Promise<void> {
    if (!this.room) return;
    if (this.room.status !== 'playing' || this.room.result) return this.sendError(ws, 'The game is not accepting moves.');
    if (this.room.turn !== color) return this.sendError(ws, 'It is not your turn.');

    const now = Date.now();
    this.settleActiveClock(now);
    const currentClock = color === 'white' ? this.room.whiteClockMs : this.room.blackClockMs;
    if (currentClock <= 0) {
      this.room.status = 'ended';
      this.room.result = `${opposite(color) === 'white' ? 'White' : 'Black'} wins on time`;
      this.room.turnStartedAt = null;
      await this.persist();
      await this.ctx.storage.deleteAlarm();
      this.broadcast();
      return;
    }

    const uci = String(rawUci ?? '').trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return this.sendError(ws, 'Invalid move format.');

    let position: Chess;
    try {
      position = Chess.fromSetup(parseFen(this.room.fen).unwrap()).unwrap();
    } catch {
      return this.sendError(ws, 'The server could not read the room position.');
    }

    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) {
      this.room.turnStartedAt = now;
      await this.persist();
      await this.scheduleForState();
      return this.sendError(ws, 'That move is not legal.');
    }

    const san = makeSan(position, move);
    position.play(move);
    this.room.fen = makeFen(position.toSetup());
    this.room.turn = position.turn;
    this.room.moves = [...this.room.moves, san].slice(-400);
    this.room.check = position.isCheck();
    this.room.checkmate = position.isCheckmate();
    this.room.lastActivityAt = now;

    const ending = resultText(position);
    if (ending) {
      this.room.status = 'ended';
      this.room.result = ending;
      this.room.turnStartedAt = null;
      await this.ctx.storage.deleteAlarm();
    } else {
      this.room.turnStartedAt = now;
    }

    await this.persist();
    await this.scheduleForState();
    this.broadcast();
  }

  private async persist(): Promise<void> {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  private async scheduleForState(): Promise<void> {
    if (!this.room) return;
    if (this.room.status === 'strategy' && this.room.strategyEndsAt) {
      await this.ctx.storage.setAlarm(this.room.strategyEndsAt);
      return;
    }
    if (this.room.status === 'playing' && this.room.turnStartedAt !== null) {
      const remaining = this.room.turn === 'white' ? this.room.whiteClockMs : this.room.blackClockMs;
      await this.ctx.storage.setAlarm(Date.now() + Math.max(1, remaining));
      return;
    }
    await this.ctx.storage.deleteAlarm();
  }
}
