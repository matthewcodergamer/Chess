import fs from 'node:fs';

const path = 'server/src/index.ts';
let source = fs.readFileSync(path, 'utf8');

function required(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  source = source.replace(from, to);
}
function regexRequired(regex, to, label) {
  if (!regex.test(source)) throw new Error(`Missing ${label}`);
  source = source.replace(regex, to);
}

required(
  "import { chess960Fen, randomChess960Id } from './chess960';\n",
  "import { chess960Fen, randomChess960Id } from './chess960';\nimport { canColorMove, clockOwner, createGameSession, isTerminalGameState, reduceGameSession, type GameResultKind, type GameSessionModel, type GameSessionState } from '../../shared/gameSession';\n",
  'shared session import',
);
source = source.replace("type RoomStatus = 'waiting' | 'coin' | 'strategy' | 'playing' | 'ended';\n", '');

required(
`type RoomState = {
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
  colorAuction: ColorAuctionState;
};`,
`type RoomState = {
  code: string;
  session: GameSessionModel;
  createdAt: number;
  lastActivityAt: number;
  players: { white: PlayerSeat; black: PlayerSeat | null };
  coin: CoinState;
  auction: AuctionState;
  colorAuction: ColorAuctionState;
};`,
  'RoomState model',
);

source = source.replace('const GAME_CLOCK_MS = 10 * 60 * 1000;\n', 'const GAME_CLOCK_MS = 10 * 60 * 1000;\nconst GAME_INCREMENT_MS = 0;\n');
source = source.replace("  | { type: 'resign' };", "  | { type: 'resign' }\n  | { type: 'offer_draw' }\n  | { type: 'accept_draw' }\n  | { type: 'decline_draw' };");

required(
  "function emptyColorAuction(): ColorAuctionState { return { bids: {}, leaderToken: null, leadingBidCents: 0, desiredColor: null, usedSessions: [], settled: false }; }\n",
  `function emptyColorAuction(): ColorAuctionState { return { bids: {}, leaderToken: null, leadingBidCents: 0, desiredColor: null, usedSessions: [], settled: false }; }
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
    id: \`room-\${legacy.code}\`,
    state: legacyState(legacy.status, legacy.result ?? null, Boolean(legacy.checkmate)),
    positionId: Number.isInteger(legacy.positionId) ? legacy.positionId : null,
    fen: typeof legacy.fen === 'string' ? legacy.fen : '',
    sideToMove: legacy.turn === 'black' ? 'black' : 'white',
    whiteClockMs: Number(legacy.whiteClockMs ?? GAME_CLOCK_MS),
    blackClockMs: Number(legacy.blackClockMs ?? GAME_CLOCK_MS),
    incrementMs: GAME_INCREMENT_MS,
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
    code: String(legacy.code), session,
    createdAt: Number(legacy.createdAt ?? now), lastActivityAt: Number(legacy.lastActivityAt ?? now),
    players: legacy.players, coin: legacy.coin ?? emptyCoin(), auction: legacy.auction ?? emptyAuction(), colorAuction: legacy.colorAuction ?? emptyColorAuction(),
  };
}
`,
  'migration helpers',
);

regexRequired(
/function resultText\(position: Chess\): string \| null \{[\s\S]*?\n\}/,
`function resultInfo(position: Chess): { kind: GameResultKind; text: string; winner: Color | null } | null {
  if (position.isCheckmate()) {
    const winner: Color = position.turn === 'white' ? 'black' : 'white';
    return { kind: 'CHECKMATE', text: \`${'${winner === \'white\' ? \'White\' : \'Black\'}'} wins by checkmate\`, winner };
  }
  if (position.isStalemate()) return { kind: 'DRAW', text: 'Draw by stalemate', winner: null };
  if (position.isInsufficientMaterial()) return { kind: 'DRAW', text: 'Draw by insufficient material', winner: null };
  return position.isEnd() ? { kind: 'DRAW', text: 'Game over', winner: null } : null;
}`,
  'resultInfo',
);
regexRequired(
/function activeClockColor\(room: RoomState\): Color \| null \{[^\n]*\}/,
"function activeClockColor(room: RoomState): Color | null { return clockOwner(room.session); }",
  'activeClockColor',
);
regexRequired(
/function remainingFor\(room: RoomState, color: Color, at = Date\.now\(\)\): number \{[\s\S]*?\n\}/,
`function remainingFor(room: RoomState, color: Color, at = Date.now()): number {
  const stored = color === 'white' ? room.session.clocks.whiteMs : room.session.clocks.blackMs;
  return activeClockColor(room) === color && room.session.clocks.startedAt !== null
    ? Math.max(0, stored - Math.max(0, at - room.session.clocks.startedAt))
    : Math.max(0, stored);
}`,
  'remainingFor',
);

regexRequired(
/function makeSnapshot\(room: RoomState, connected: Set<Color>, viewerToken: string \| null\) \{[\s\S]*?\n\}\nfunction parseRoomPath/,
`function makeSnapshot(room: RoomState, connected: Set<Color>, viewerToken: string | null) {
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
  const connectedStatus = room.players.black && (!whiteConnected || !blackConnected) ? 'RECONNECTING' : 'CONNECTED';
  const effectiveState = room.session.state === 'ACTIVE' && connectedStatus === 'RECONNECTING' ? 'RECONNECTING' : room.session.state;
  const session: GameSessionModel = {
    ...room.session,
    state: effectiveState,
    clocks: { ...room.session.clocks, whiteMs: remainingFor(room, 'white', now), blackMs: remainingFor(room, 'black', now) },
    countdownMs: room.session.countdownEndsAt ? Math.max(0, room.session.countdownEndsAt - now) : room.session.countdownMs,
    connection: { status: connectedStatus, white: whiteConnected, black: blackConnected },
  };
  return {
    code: room.code,
    session,
    status: legacyStatus(session.state), positionId: session.positionId, fen: session.fen, turn: session.sideToMove,
    activeClock: clockOwner(session), awaitingClockPress: session.pendingClockPress,
    whiteClockMs: session.clocks.whiteMs, blackClockMs: session.clocks.blackMs,
    turnStartedAt: session.clocks.startedAt, strategyEndsAt: session.countdownEndsAt, serverNow: now,
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
function parseRoomPath`,
  'makeSnapshot',
);

required(
`      this.room = (await this.ctx.storage.get<RoomState>('room')) ?? null;
      if (this.room) {
        if (!this.room.coin) this.room.coin = emptyCoin();
        if (!this.room.auction) this.room.auction = emptyAuction();
        if (!this.room.colorAuction) this.room.colorAuction = emptyColorAuction();
        if (this.room.pendingClockPress === undefined) this.room.pendingClockPress = null;
      }`,
`      this.room = migrateStoredRoom(await this.ctx.storage.get<unknown>('room'));
      if (this.room) {
        if (!this.room.coin) this.room.coin = emptyCoin();
        if (!this.room.auction) this.room.auction = emptyAuction();
        if (!this.room.colorAuction) this.room.colorAuction = emptyColorAuction();
      }`,
  'constructor migration',
);

required(
`      this.room = {
        code, status: 'waiting', positionId, fen: chess960Fen(positionId), turn: 'white', pendingClockPress: null,
        whiteClockMs: GAME_CLOCK_MS, blackClockMs: GAME_CLOCK_MS, turnStartedAt: null, strategyEndsAt: null,
        moves: [], result: null, check: false, checkmate: false, createdAt: now, lastActivityAt: now,
        players: { white: { name: normalizeName(body.name), token }, black: null }, coin: emptyCoin(), auction: emptyAuction(), colorAuction: emptyColorAuction(),
      };`,
`      this.room = {
        code,
        session: createGameSession({ id: \`room-\${code}\`, state: 'LOBBY', positionId, fen: chess960Fen(positionId), sideToMove: 'white', clockMs: GAME_CLOCK_MS, incrementMs: GAME_INCREMENT_MS, connectionStatus: 'DISCONNECTED', now }),
        createdAt: now, lastActivityAt: now,
        players: { white: { name: normalizeName(body.name), token }, black: null }, coin: emptyCoin(), auction: emptyAuction(), colorAuction: emptyColorAuction(),
      };`,
  'room creation',
);

// All remaining game-field reads/writes are redirected into the canonical session object.
for (const [field, replacement] of [
  ['status', 'session.state'],
  ['positionId', 'session.positionId'],
  ['fen', 'session.fen'],
  ['turn', 'session.sideToMove'],
  ['pendingClockPress', 'session.pendingClockPress'],
  ['whiteClockMs', 'session.clocks.whiteMs'],
  ['blackClockMs', 'session.clocks.blackMs'],
  ['turnStartedAt', 'session.clocks.startedAt'],
  ['strategyEndsAt', 'session.countdownEndsAt'],
  ['moves', 'session.movesSan'],
  ['result', 'session.result'],
  ['checkmate', 'session.checkmate'],
  ['check', 'session.check'],
]) {
  source = source.replaceAll(`room.${field}`, `room.${replacement}`);
  source = source.replaceAll(`this.room.${field}`, `this.room.${replacement}`);
}

for (const [oldState, nextState] of [
  ['waiting', 'LOBBY'], ['coin', 'COIN_TOSS'], ['strategy', 'COUNTDOWN'], ['playing', 'ACTIVE'],
]) {
  source = source.replaceAll(`session.state === '${oldState}'`, `session.state === '${nextState}'`);
  source = source.replaceAll(`session.state !== '${oldState}'`, `session.state !== '${nextState}'`);
  source = source.replaceAll(`session.state = '${oldState}'`, `session.state = '${nextState}'`);
}
source = source.replaceAll("this.room.session.state === 'ended'", 'isTerminalGameState(this.room.session.state)');
source = source.replaceAll("this.room.session.state !== 'ended'", '!isTerminalGameState(this.room.session.state)');

// Server commands use the session machine for all lifecycle changes.
source = source.replace(
`    if (payload.type === 'start_now') {
      if (this.room.session.state !== 'COUNTDOWN' || !this.room.players.black) return this.sendError(ws, 'The game cannot start yet.');
      this.startPlaying(Date.now()); await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (payload.type === 'resign') {
      if (this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'There is no active game to resign.');
      this.settleActiveClock(Date.now()); this.room.session.state = 'ended'; this.room.session.result = \`${'${color === \'white\' ? \'Black\' : \'White\'}'} wins by resignation\`;
      this.room.session.pendingClockPress = null; this.room.session.clocks.startedAt = null; this.room.lastActivityAt = Date.now();
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }`,
`    if (payload.type === 'start_now') {
      if (this.room.session.state !== 'COUNTDOWN' || !this.room.players.black) return this.sendError(ws, 'The game cannot start yet.');
      this.startPlaying(Date.now()); await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (payload.type === 'offer_draw') return void await this.handleDrawOffer(ws, color);
    if (payload.type === 'accept_draw') return void await this.handleDrawAccept(ws, color);
    if (payload.type === 'decline_draw') return void await this.handleDrawDecline(ws, color);
    if (payload.type === 'resign') {
      if (this.room.session.state !== 'ACTIVE' && this.room.session.state !== 'RECONNECTING' && this.room.session.state !== 'PAUSED') return this.sendError(ws, 'There is no active game to resign.');
      const now = Date.now(); this.settleActiveClock(now);
      this.room.session = reduceGameSession(this.room.session, { type: 'RESIGN', by: color, at: now });
      this.room.lastActivityAt = now;
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }`,
);

regexRequired(
/  async webSocketClose\(\): Promise<void> \{ this\.broadcast\(\); \}\n  async webSocketError\(\): Promise<void> \{ this\.broadcast\(\); \}/,
`  async webSocketClose(): Promise<void> { await this.syncConnectionState(); this.broadcast(); }
  async webSocketError(): Promise<void> { await this.syncConnectionState(); this.broadcast(); }`,
  'socket close state',
);
source = source.replace(
"      this.ctx.acceptWebSocket(server); server.serializeAttachment({ token } satisfies SocketAttachment); this.sendSnapshot(server, token); queueMicrotask(() => this.broadcast());",
"      this.ctx.acceptWebSocket(server); server.serializeAttachment({ token } satisfies SocketAttachment); this.sendSnapshot(server, token); queueMicrotask(() => { void this.syncConnectionState().then(() => this.broadcast()); });",
);

regexRequired(
/  async alarm\(\): Promise<void> \{[\s\S]*?\n  \}\n\n  private connectedColors/,
`  async alarm(): Promise<void> {
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
    if (this.room.session.state === 'ACTIVE') {
      this.settleActiveClock(now);
      if (this.room.session.state === 'TIMEOUT') {
        this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
      }
      await this.persist(); await this.scheduleForState(); this.broadcast();
    }
  }

  private connectedColors`,
  'alarm state machine',
);

regexRequired(
/  private prepareCoin\(now: number\): void \{[\s\S]*?\n  \}\n\n  private startStrategy\(now: number\): void \{[\s\S]*?\n  \}/,
`  private prepareCoin(now: number): void {
    if (!this.room) return;
    const current = this.room.session;
    this.room.session = createGameSession({
      id: current.id, state: 'COIN_TOSS', positionId: current.positionId, fen: current.fen, sideToMove: 'white',
      clockMs: GAME_CLOCK_MS, incrementMs: GAME_INCREMENT_MS, connectionStatus: 'CONNECTED', now,
    });
    this.room.coin = emptyCoin(); this.room.auction = emptyAuction(); this.room.colorAuction = emptyColorAuction(); this.room.lastActivityAt = now;
  }

  private startStrategy(now: number): void {
    if (!this.room) return;
    this.room.session = reduceGameSession(this.room.session, { type: 'TRANSITION', to: 'COUNTDOWN', at: now });
    this.room.session = reduceGameSession(this.room.session, { type: 'SET_COUNTDOWN', remainingMs: STRATEGY_MS, endsAt: now + STRATEGY_MS, at: now });
    this.room.lastActivityAt = now;
  }`,
  'prepare/start countdown',
);

regexRequired(
/  private rerollPosition\(\): void \{[\s\S]*?\n  \}\n  private startPlaying\(now: number\): void \{[\s\S]*?\n  \}\n  private settleActiveClock\(now: number\): void \{[\s\S]*?\n  \}/,
`  private rerollPosition(): void {
    if (!this.room) return;
    const positionId = randomChess960Id();
    this.room.session = {
      ...this.room.session,
      positionId, fen: chess960Fen(positionId), sideToMove: 'white', pendingClockPress: null,
      movesSan: [], moveNumber: 0, result: null, resultKind: null, winner: null,
      drawOffers: { white: false, black: false }, resignedBy: null, check: false, checkmate: false,
    };
  }
  private startPlaying(now: number): void {
    if (!this.room || this.room.session.state !== 'COUNTDOWN') return;
    this.room.session = reduceGameSession(this.room.session, { type: 'SET_COUNTDOWN', remainingMs: 0, endsAt: null, at: now });
    this.room.session = reduceGameSession(this.room.session, { type: 'TRANSITION', to: 'ACTIVE', at: now });
    this.room.lastActivityAt = now;
  }
  private settleActiveClock(now: number): void {
    if (!this.room || this.room.session.state !== 'ACTIVE' || this.room.session.clocks.startedAt === null) return;
    const elapsed = Math.max(0, now - this.room.session.clocks.startedAt);
    if (!elapsed) return;
    this.room.session = reduceGameSession(this.room.session, { type: 'CLOCK_TICK', elapsedMs: elapsed, at: now });
  }`,
  'clock lifecycle',
);

regexRequired(
/  private async handleClockSlap\(ws: WebSocket, color: Color\): Promise<void> \{[\s\S]*?\n  \}\n  private async handleMove/,
`  private async handleClockSlap(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE' || this.room.session.result) return this.sendError(ws, 'The clock is not accepting presses.');
    if (this.room.session.pendingClockPress !== color) return this.sendError(ws, 'Make your move before pressing your clock.');
    const now = Date.now(); this.settleActiveClock(now);
    if (this.room.session.state === 'TIMEOUT') {
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
  private async handleMove`,
  'clock slap and draw handlers',
);

regexRequired(
/  private async handleMove\(ws: WebSocket, color: Color, rawUci: unknown\): Promise<void> \{[\s\S]*?\n  \}\n\n  private async persist/,
`  private async handleMove(ws: WebSocket, color: Color, rawUci: unknown): Promise<void> {
    if (!this.room) return;
    if (!canColorMove(this.room.session, color)) return this.sendError(ws, this.room.session.pendingClockPress ? 'The previous move is waiting for a clock press.' : 'The game is not accepting that move.');
    const now = Date.now(); this.settleActiveClock(now);
    if (this.room.session.state === 'TIMEOUT') {
      this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    const uci = String(rawUci ?? '').trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return this.sendError(ws, 'Invalid move format.');
    let position: Chess;
    try { position = Chess.fromSetup(parseFen(this.room.session.fen).unwrap()).unwrap(); }
    catch { return this.sendError(ws, 'The server could not read the room position.'); }
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) { this.room.session.clocks.startedAt = now; await this.persist(); await this.scheduleForState(); return this.sendError(ws, 'That move is not legal.'); }
    const san = makeSan(position, move); position.play(move);
    this.room.session = reduceGameSession(this.room.session, {
      type: 'MOVE_COMMITTED', fen: makeFen(position.toSetup()), sideToMove: position.turn, mover: color, san,
      check: position.isCheck(), checkmate: position.isCheckmate(), at: now,
    });
    this.room.lastActivityAt = now;
    const ending = resultInfo(position);
    if (ending) {
      this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', ...ending, at: now });
      await this.ctx.storage.deleteAlarm();
    }
    await this.persist(); await this.scheduleForState(); this.broadcast();
  }

  private async persist`,
  'move handler',
);

regexRequired(
/  private async scheduleForState\(\): Promise<void> \{[\s\S]*?\n  \}\n\}/,
`  private async syncConnectionState(): Promise<void> {
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
      this.room.session = reduceGameSession(this.room.session, { type: 'SET_CONNECTION', status: 'CONNECTED', white, black, at: now });
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
    if (this.room.session.state === 'ACTIVE' && this.room.session.clocks.startedAt !== null) {
      const owner = activeClockColor(this.room); if (!owner) return;
      const remaining = owner === 'white' ? this.room.session.clocks.whiteMs : this.room.session.clocks.blackMs;
      await this.ctx.storage.setAlarm(Date.now() + Math.max(1, remaining)); return;
    }
    await this.ctx.storage.deleteAlarm();
  }
}`,
  'schedule and connection state',
);

// Normalize any leftover lifecycle literals generated by the field redirect.
source = source.replaceAll("this.room.session.state = 'ended'", "this.room.session.state = 'FINAL'");
source = source.replaceAll("this.room.session.state !== 'ended'", "!isTerminalGameState(this.room.session.state)");
source = source.replaceAll("this.room.session.state === 'ended'", "isTerminalGameState(this.room.session.state)");

fs.writeFileSync(path, source);
console.log('Realtime room storage migrated to shared authoritative GameSessionModel.');
