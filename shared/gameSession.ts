export type GameColor = 'white' | 'black';

export type GameSessionState =
  | 'LOBBY'
  | 'READY'
  | 'COLOR_SELECTION'
  | 'COIN_TOSS'
  | 'COUNTDOWN'
  | 'ACTIVE'
  | 'PAUSED'
  | 'RECONNECTING'
  | 'CHECKMATE'
  | 'DRAW'
  | 'RESIGN'
  | 'TIMEOUT'
  | 'FINAL';

export type GameResultKind = 'CHECKMATE' | 'DRAW' | 'RESIGN' | 'TIMEOUT' | 'OTHER';
export type GameConnectionStatus = 'LOCAL' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export type GameSessionModel = {
  id: string;
  state: GameSessionState;
  positionId: number | null;
  fen: string;
  sideToMove: GameColor;
  clocks: {
    whiteMs: number;
    blackMs: number;
    baseMs: number;
    incrementMs: number;
    startedAt: number | null;
  };
  pendingClockPress: GameColor | null;
  countdownMs: number;
  countdownEndsAt: number | null;
  moveNumber: number;
  movesSan: string[];
  drawOffers: { white: boolean; black: boolean };
  resignedBy: GameColor | null;
  connection: {
    status: GameConnectionStatus;
    white: boolean;
    black: boolean;
  };
  result: string | null;
  resultKind: GameResultKind | null;
  winner: GameColor | null;
  check: boolean;
  checkmate: boolean;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number | null;
};

export type CreateGameSessionOptions = {
  id?: string;
  state?: GameSessionState;
  positionId?: number | null;
  fen?: string;
  sideToMove?: GameColor;
  clockMs?: number;
  whiteClockMs?: number;
  blackClockMs?: number;
  incrementMs?: number;
  clockStartedAt?: number | null;
  countdownMs?: number;
  countdownEndsAt?: number | null;
  connectionStatus?: GameConnectionStatus;
  now?: number;
};

export type GameSessionEvent =
  | { type: 'RESET'; options?: CreateGameSessionOptions }
  | { type: 'TRANSITION'; to: GameSessionState; at?: number }
  | { type: 'SET_POSITION'; fen: string; sideToMove: GameColor; positionId?: number | null; check?: boolean; checkmate?: boolean; at?: number }
  | { type: 'MOVE_COMMITTED'; fen: string; sideToMove: GameColor; mover: GameColor; san: string; check?: boolean; checkmate?: boolean; at?: number }
  | { type: 'CLOCK_TICK'; elapsedMs: number; at?: number }
  | { type: 'CLOCK_TRANSFERRED'; at?: number }
  | { type: 'SET_CLOCKS'; whiteMs: number; blackMs: number; startedAt?: number | null; at?: number }
  | { type: 'SET_INCREMENT'; incrementMs: number; at?: number }
  | { type: 'SET_TIME_CONTROL'; baseMs: number; incrementMs: number; resetClocks?: boolean; at?: number }
  | { type: 'SET_COUNTDOWN'; remainingMs: number; endsAt?: number | null; at?: number }
  | { type: 'COUNTDOWN_TICK'; elapsedMs: number; at?: number }
  | { type: 'SET_CONNECTION'; status: GameConnectionStatus; white?: boolean; black?: boolean; at?: number }
  | { type: 'OFFER_DRAW'; by: GameColor; at?: number }
  | { type: 'CLEAR_DRAW_OFFER'; by?: GameColor; at?: number }
  | { type: 'RESIGN'; by: GameColor; text?: string; at?: number }
  | { type: 'FINISH'; kind: GameResultKind; text: string; winner?: GameColor | null; at?: number }
  | { type: 'FINALIZE'; at?: number };

const TERMINAL = new Set<GameSessionState>(['CHECKMATE', 'DRAW', 'RESIGN', 'TIMEOUT', 'FINAL']);
const RESULT_STATES = new Set<GameSessionState>(['CHECKMATE', 'DRAW', 'RESIGN', 'TIMEOUT']);
const PLAY_STATES = new Set<GameSessionState>(['ACTIVE', 'PAUSED', 'RECONNECTING']);
const PRE_GAME_STATES = new Set<GameSessionState>(['LOBBY', 'READY', 'COLOR_SELECTION', 'COIN_TOSS', 'COUNTDOWN']);

const TRANSITIONS: Record<GameSessionState, ReadonlySet<GameSessionState>> = {
  LOBBY: new Set(['READY', 'COLOR_SELECTION', 'COIN_TOSS', 'COUNTDOWN', 'FINAL']),
  READY: new Set(['COLOR_SELECTION', 'COIN_TOSS', 'COUNTDOWN', 'FINAL']),
  COLOR_SELECTION: new Set(['COIN_TOSS', 'COUNTDOWN', 'FINAL']),
  COIN_TOSS: new Set(['COUNTDOWN', 'FINAL']),
  COUNTDOWN: new Set(['ACTIVE', 'PAUSED', 'RECONNECTING', 'FINAL']),
  ACTIVE: new Set(['PAUSED', 'RECONNECTING', 'CHECKMATE', 'DRAW', 'RESIGN', 'TIMEOUT', 'FINAL']),
  PAUSED: new Set(['ACTIVE', 'RECONNECTING', 'CHECKMATE', 'DRAW', 'RESIGN', 'TIMEOUT', 'FINAL']),
  RECONNECTING: new Set(['ACTIVE', 'PAUSED', 'CHECKMATE', 'DRAW', 'RESIGN', 'TIMEOUT', 'FINAL']),
  CHECKMATE: new Set(['FINAL']),
  DRAW: new Set(['FINAL']),
  RESIGN: new Set(['FINAL']),
  TIMEOUT: new Set(['FINAL']),
  FINAL: new Set(),
};

function nowOr(value?: number): number {
  return Number.isFinite(value) ? Number(value) : Date.now();
}

function opposite(color: GameColor): GameColor {
  return color === 'white' ? 'black' : 'white';
}

export function createGameSession(options: CreateGameSessionOptions = {}): GameSessionModel {
  const now = nowOr(options.now);
  const clockMs = Math.max(0, options.clockMs ?? 10 * 60 * 1000);
  const connectionStatus = options.connectionStatus ?? 'LOCAL';
  const connectedByDefault = connectionStatus === 'LOCAL' || connectionStatus === 'CONNECTED';
  return {
    id: options.id ?? `session-${now}-${Math.random().toString(36).slice(2, 10)}`,
    state: options.state ?? 'LOBBY',
    positionId: options.positionId ?? null,
    fen: options.fen ?? '',
    sideToMove: options.sideToMove ?? 'white',
    clocks: {
      whiteMs: Math.max(0, options.whiteClockMs ?? clockMs),
      blackMs: Math.max(0, options.blackClockMs ?? clockMs),
      baseMs: clockMs,
      incrementMs: Math.max(0, options.incrementMs ?? 0),
      startedAt: options.clockStartedAt ?? null,
    },
    pendingClockPress: null,
    countdownMs: Math.max(0, options.countdownMs ?? 0),
    countdownEndsAt: options.countdownEndsAt ?? null,
    moveNumber: 0,
    movesSan: [],
    drawOffers: { white: false, black: false },
    resignedBy: null,
    connection: {
      status: connectionStatus,
      white: connectedByDefault,
      black: connectedByDefault,
    },
    result: null,
    resultKind: null,
    winner: null,
    check: false,
    checkmate: false,
    createdAt: now,
    updatedAt: now,
    finalizedAt: null,
  };
}

export function canTransitionGameSession(from: GameSessionState, to: GameSessionState): boolean {
  return from === to || TRANSITIONS[from].has(to);
}

export function isTerminalGameState(state: GameSessionState): boolean {
  return TERMINAL.has(state);
}

export function isResultGameState(state: GameSessionState): boolean {
  return RESULT_STATES.has(state);
}

export function isPlayGameState(state: GameSessionState): boolean {
  return PLAY_STATES.has(state);
}

export function isPreGameState(state: GameSessionState): boolean {
  return PRE_GAME_STATES.has(state);
}

export function clockOwner(session: GameSessionModel): GameColor | null {
  if (session.state !== 'ACTIVE' && session.state !== 'RECONNECTING') return null;
  return session.pendingClockPress ?? session.sideToMove;
}

export function canColorMove(session: GameSessionModel, color: GameColor): boolean {
  return session.state === 'ACTIVE' && !session.pendingClockPress && !session.result && session.sideToMove === color;
}

export function canOfferDraw(session: GameSessionModel): boolean {
  return session.state === 'ACTIVE' && !session.result;
}

export function canResignGameSession(session: GameSessionModel): boolean {
  return (session.state === 'ACTIVE' || session.state === 'PAUSED' || session.state === 'RECONNECTING') && !session.result;
}

export function canLeaveGameSession(session: GameSessionModel): boolean {
  return !isPlayGameState(session.state);
}

export function sessionUiPhase(session: GameSessionModel): 'setup' | 'strategy' | 'playing' | 'ended' {
  if (session.state === 'COUNTDOWN') return 'strategy';
  if (isPlayGameState(session.state)) return 'playing';
  if (isTerminalGameState(session.state)) return 'ended';
  return 'setup';
}

export function gameStateForResult(kind: GameResultKind): GameSessionState {
  if (kind === 'CHECKMATE') return 'CHECKMATE';
  if (kind === 'DRAW') return 'DRAW';
  if (kind === 'RESIGN') return 'RESIGN';
  if (kind === 'TIMEOUT') return 'TIMEOUT';
  return 'FINAL';
}

function transition(session: GameSessionModel, to: GameSessionState, at: number): GameSessionModel {
  if (!canTransitionGameSession(session.state, to)) {
    throw new Error(`Invalid game-session transition ${session.state} -> ${to}`);
  }
  return {
    ...session,
    state: to,
    clocks: { ...session.clocks, startedAt: to === 'ACTIVE' ? at : null },
    updatedAt: at,
    finalizedAt: to === 'FINAL' ? at : session.finalizedAt,
  };
}

export function reduceGameSession(session: GameSessionModel, event: GameSessionEvent): GameSessionModel {
  const at = nowOr('at' in event ? event.at : undefined);
  switch (event.type) {
    case 'RESET':
      return createGameSession({ ...event.options, id: event.options?.id ?? session.id, now: at });
    case 'TRANSITION':
      return transition(session, event.to, at);
    case 'SET_POSITION':
      return {
        ...session,
        positionId: event.positionId === undefined ? session.positionId : event.positionId,
        fen: event.fen,
        sideToMove: event.sideToMove,
        check: Boolean(event.check),
        checkmate: Boolean(event.checkmate),
        updatedAt: at,
      };
    case 'MOVE_COMMITTED':
      if (session.state !== 'ACTIVE' || session.pendingClockPress || session.sideToMove !== event.mover || session.result) return session;
      return {
        ...session,
        fen: event.fen,
        sideToMove: event.sideToMove,
        pendingClockPress: event.mover,
        moveNumber: session.moveNumber + 1,
        movesSan: [...session.movesSan, event.san].slice(-400),
        drawOffers: { white: false, black: false },
        check: Boolean(event.check),
        checkmate: Boolean(event.checkmate),
        clocks: { ...session.clocks, startedAt: at },
        updatedAt: at,
      };
    case 'CLOCK_TICK': {
      const owner = clockOwner(session);
      if (!owner || event.elapsedMs <= 0) return session;
      const key = owner === 'white' ? 'whiteMs' : 'blackMs';
      const remaining = Math.max(0, session.clocks[key] - event.elapsedMs);
      const next: GameSessionModel = {
        ...session,
        clocks: { ...session.clocks, [key]: remaining, startedAt: remaining > 0 ? at : null },
        updatedAt: at,
      };
      if (remaining > 0) return next;
      const winner = opposite(owner);
      return {
        ...next,
        state: 'TIMEOUT',
        pendingClockPress: null,
        result: `${winner === 'white' ? 'White' : 'Black'} wins on time`,
        resultKind: 'TIMEOUT',
        winner,
      };
    }
    case 'CLOCK_TRANSFERRED': {
      if (session.state !== 'ACTIVE' || !session.pendingClockPress) return session;
      const mover = session.pendingClockPress;
      const key = mover === 'white' ? 'whiteMs' : 'blackMs';
      return {
        ...session,
        pendingClockPress: null,
        clocks: {
          ...session.clocks,
          [key]: session.clocks[key] + session.clocks.incrementMs,
          startedAt: at,
        },
        updatedAt: at,
      };
    }
    case 'SET_CLOCKS':
      return {
        ...session,
        clocks: {
          ...session.clocks,
          whiteMs: Math.max(0, event.whiteMs),
          blackMs: Math.max(0, event.blackMs),
          startedAt: event.startedAt === undefined ? session.clocks.startedAt : event.startedAt,
        },
        updatedAt: at,
      };
    case 'SET_INCREMENT':
      return { ...session, clocks: { ...session.clocks, incrementMs: Math.max(0, event.incrementMs) }, updatedAt: at };
    case 'SET_TIME_CONTROL': {
      if (!isPreGameState(session.state)) return session;
      const baseMs = Math.max(0, event.baseMs);
      const incrementMs = Math.max(0, event.incrementMs);
      return {
        ...session,
        clocks: {
          ...session.clocks,
          baseMs,
          incrementMs,
          whiteMs: event.resetClocks === false ? session.clocks.whiteMs : baseMs,
          blackMs: event.resetClocks === false ? session.clocks.blackMs : baseMs,
          startedAt: null,
        },
        updatedAt: at,
      };
    }
    case 'SET_COUNTDOWN':
      return { ...session, countdownMs: Math.max(0, event.remainingMs), countdownEndsAt: event.endsAt ?? null, updatedAt: at };
    case 'COUNTDOWN_TICK': {
      if (session.state !== 'COUNTDOWN' || event.elapsedMs <= 0) return session;
      const remaining = Math.max(0, session.countdownMs - event.elapsedMs);
      if (remaining > 0) return { ...session, countdownMs: remaining, updatedAt: at };
      return transition({ ...session, countdownMs: 0, countdownEndsAt: null }, 'ACTIVE', at);
    }
    case 'SET_CONNECTION': {
      const next: GameSessionModel = {
        ...session,
        connection: {
          status: event.status,
          white: event.white ?? session.connection.white,
          black: event.black ?? session.connection.black,
        },
        updatedAt: at,
      };
      if (session.state === 'ACTIVE' && (event.status === 'RECONNECTING' || event.status === 'DISCONNECTED')) {
        return { ...next, state: 'RECONNECTING' };
      }
      if (session.state === 'RECONNECTING' && (event.status === 'CONNECTED' || event.status === 'LOCAL')) {
        return { ...next, state: 'ACTIVE', clocks: { ...next.clocks, startedAt: next.clocks.startedAt ?? at } };
      }
      return next;
    }
    case 'OFFER_DRAW':
      if (!canOfferDraw(session)) return session;
      return { ...session, drawOffers: { ...session.drawOffers, [event.by]: true }, updatedAt: at };
    case 'CLEAR_DRAW_OFFER':
      return {
        ...session,
        drawOffers: event.by ? { ...session.drawOffers, [event.by]: false } : { white: false, black: false },
        updatedAt: at,
      };
    case 'RESIGN': {
      if (!canResignGameSession(session)) return session;
      const winner = opposite(event.by);
      return {
        ...session,
        state: 'RESIGN',
        resignedBy: event.by,
        pendingClockPress: null,
        clocks: { ...session.clocks, startedAt: null },
        result: event.text ?? `${winner === 'white' ? 'White' : 'Black'} wins by resignation`,
        resultKind: 'RESIGN',
        winner,
        updatedAt: at,
      };
    }
    case 'FINISH': {
      const state = gameStateForResult(event.kind);
      if (!canTransitionGameSession(session.state, state) && session.state !== state) return session;
      return {
        ...session,
        state,
        pendingClockPress: null,
        clocks: { ...session.clocks, startedAt: null },
        result: event.text,
        resultKind: event.kind,
        winner: event.winner ?? null,
        checkmate: event.kind === 'CHECKMATE' ? true : session.checkmate,
        updatedAt: at,
      };
    }
    case 'FINALIZE':
      return transition(session, 'FINAL', at);
  }
}

export function resolveElapsedClocks(session: GameSessionModel, at = Date.now()): GameSessionModel {
  const owner = clockOwner(session);
  if (!owner || session.clocks.startedAt === null) return session;
  const elapsed = Math.max(0, at - session.clocks.startedAt);
  if (!elapsed) return session;
  return reduceGameSession(session, { type: 'CLOCK_TICK', elapsedMs: elapsed, at });
}
