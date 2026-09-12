import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, Role } from 'chessops/types';
import { parseSquare, parseUci } from 'chessops/util';
import { canColorMove, clockOwner, sessionUiPhase, type GameSessionModel } from '../../shared/gameSession';
import { adjudicateChess, appendPositionHistory, chessPositionKey } from '../../shared/chess960Rules';
import { TIME_CONTROL_PRESETS, type TimeControl } from '../../shared/timeControl';
import { chess960BackRank, chess960Fen, randomChess960Id } from './chess960';
import { useGameSession } from './useGameSession';
import { playChessSound } from '../ui/sound';

export type LocalGameMode = 'human' | 'ai';
export type LocalDifficulty = 'easy' | 'hard' | 'crazy';
export type LocalSideChoice = 'white' | 'black' | 'random';
export type LocalPromotionRole = Extract<Role, 'queen' | 'rook' | 'bishop' | 'knight'>;
export type LocalEngineStatus = 'off' | 'loading' | 'ready' | 'thinking' | 'error';

type Engine = {
  init: () => Promise<void>;
  isReady: () => boolean;
  bestMove: (fen: string, difficulty: LocalDifficulty) => Promise<string>;
  cancelSearch: () => void;
  destroy: () => void;
};

export const LOCAL_DIFFICULTIES: Record<LocalDifficulty, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Relaxed and forgiving' },
  hard: { label: 'Hard', note: 'Strong club-level play' },
  crazy: { label: 'Crazy Hard', note: 'Stockfish at full skill' },
};

export const LOCAL_STRATEGY_MS = 2 * 60 * 1000;
export const DEFAULT_LOCAL_TIME_CONTROL = TIME_CONTROL_PRESETS['10+5'];

function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }
function chooseColor(choice: LocalSideChoice): Color { return choice === 'random' ? (Math.random() < .5 ? 'white' : 'black') : choice; }

export function formatLocalClockMs(value: number): string {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export type LocalGameController = {
  session: GameSessionModel;
  phase: ReturnType<typeof sessionUiPhase>;
  mode: LocalGameMode;
  setMode: (value: LocalGameMode) => void;
  orientation: Color;
  setOrientation: (value: Color | ((current: Color) => Color)) => void;
  difficulty: LocalDifficulty;
  setDifficulty: (value: LocalDifficulty) => void;
  sideChoice: LocalSideChoice;
  setSideChoice: (value: LocalSideChoice) => void;
  timeControl: TimeControl;
  setTimeControl: (value: TimeControl) => void;
  engineStatus: LocalEngineStatus;
  engineError: string;
  positionId: number | null;
  fen: string;
  turn: Color;
  moves: string[];
  backRank: string;
  humanColor: Color | null;
  aiColor: Color | null;
  movableColor: Color | undefined;
  legalDests: Map<string, string[]>;
  lastMove: [Key, Key] | undefined;
  promotion: { orig: Key; dest: Key } | null;
  whiteClockMs: number;
  blackClockMs: number;
  activeColor: Color | null;
  pendingSlap: Color | null;
  fastForward: boolean;
  setFastForward: (value: boolean) => void;
  createPosition: () => void;
  boardMove: (orig: Key, dest: Key) => void;
  promote: (role: LocalPromotionRole) => void;
  startNow: () => void;
  slapClock: () => void;
  agreeDraw: (by: Color) => void;
  resign: (by: Color) => void;
  playerName: (color: Color) => string;
  connectionFor: (color: Color) => string;
  ratingFor: (color: Color) => string;
};

export function useLocalGameController(initialMode: LocalGameMode): LocalGameController {
  // This hook is the only local-game rules/execution owner. 2D and 3D renderers
  // consume its state and callbacks; neither renderer is allowed to adjudicate chess.
  const position = useRef<Chess | null>(null);
  const positionHistory = useRef<string[]>([]);
  const engine = useRef<Engine | null>(null);
  const enginePromise = useRef<Promise<Engine> | null>(null);
  const terminalSoundPlayed = useRef(false);

  const { session, dispatchSession } = useGameSession({
    state: 'LOBBY',
    clockMs: DEFAULT_LOCAL_TIME_CONTROL.baseMs,
    incrementMs: DEFAULT_LOCAL_TIME_CONTROL.incrementMs,
    connectionStatus: 'LOCAL',
  });

  const [mode, setMode] = useState<LocalGameMode>(initialMode);
  const [orientation, setOrientation] = useState<Color>('white');
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [fastForward, setFastForward] = useState(false);
  const [difficulty, setDifficulty] = useState<LocalDifficulty>('hard');
  const [sideChoice, setSideChoice] = useState<LocalSideChoice>('white');
  const [humanColor, setHumanColor] = useState<Color | null>(null);
  const [engineStatus, setEngineStatus] = useState<LocalEngineStatus>('off');
  const [engineError, setEngineError] = useState('');
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [timeControl, setTimeControl] = useState<TimeControl>(() => ({ ...DEFAULT_LOCAL_TIME_CONTROL }));

  const phase = sessionUiPhase(session);
  const positionId = session.positionId;
  const fen = session.fen;
  const turn = session.sideToMove as Color;
  const moves = session.movesSan;
  const activeColor = clockOwner(session) as Color | null;
  const pendingSlap = session.pendingClockPress as Color | null;
  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);

  const ensureEngine = useCallback(async (): Promise<Engine> => {
    if (engine.current) return engine.current;
    if (!enginePromise.current) {
      enginePromise.current = import('../engine/stockfish').then(({ StockfishEngine }) => {
        const value = new StockfishEngine() as Engine;
        engine.current = value;
        return value;
      });
    }
    return engine.current ?? enginePromise.current;
  }, []);

  const humanCanMove = useCallback((pos: Chess) => {
    if (!canColorMove(session, pos.turn)) return false;
    return mode === 'human' || humanColor === pos.turn;
  }, [humanColor, mode, session]);

  const movableColor = position.current && humanCanMove(position.current) ? position.current.turn : undefined;
  const legalDests = useMemo(() => {
    const pos = position.current;
    if (!pos || !humanCanMove(pos)) return new Map<string, string[]>();
    return chessgroundDests(pos, { chess960: true }) as unknown as Map<string, string[]>;
  }, [fen, humanCanMove, session.pendingClockPress, session.state, session.sideToMove]);

  const createPosition = useCallback(() => {
    const id = randomChess960Id();
    const pos = Chess.fromSetup(parseFen(chess960Fen(id)).unwrap()).unwrap();
    const chosen = mode === 'ai' ? chooseColor(sideChoice) : null;
    position.current = pos;
    positionHistory.current = [chessPositionKey(pos)];
    terminalSoundPlayed.current = false;
    dispatchSession({
      type: 'RESET',
      options: {
        state: 'COUNTDOWN',
        positionId: id,
        fen: makeFen(pos.toSetup()),
        sideToMove: 'white',
        clockMs: timeControl.baseMs,
        incrementMs: timeControl.incrementMs,
        countdownMs: LOCAL_STRATEGY_MS,
        connectionStatus: 'LOCAL',
      },
    });
    setOrientation(chosen ?? 'white');
    setHumanColor(chosen);
    setLastMove(undefined);
    setFastForward(false);
    setPromotion(null);
    setEngineError('');
  }, [dispatchSession, mode, sideChoice, timeControl]);

  const finishMove = useCallback((move: Move, orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || !canColorMove(session, pos.turn) || !pos.isLegal(move)) return false;
    const movingColor = pos.turn;
    const fromSquare = parseSquare(orig);
    const toSquare = parseSquare(dest);
    const movingPiece = fromSquare === undefined ? undefined : pos.board.get(fromSquare);
    const capturedPiece = toSquare === undefined ? undefined : pos.board.get(toSquare);
    const isCapture = Boolean(capturedPiece) || Boolean(movingPiece?.role === 'pawn' && orig[0] !== dest[0]);
    const san = makeSan(pos, move);
    pos.play(move);
    positionHistory.current = appendPositionHistory(positionHistory.current, pos);
    playChessSound(isCapture ? 'capture' : 'move');
    dispatchSession({
      type: 'MOVE_COMMITTED',
      fen: makeFen(pos.toSetup()),
      sideToMove: pos.turn,
      mover: movingColor,
      san,
      check: pos.isCheck(),
      checkmate: pos.isCheckmate(),
    });
    setLastMove([orig, dest]);
    const ending = adjudicateChess(pos, positionHistory.current);
    if (ending) {
      dispatchSession({ type: 'FINISH', ...ending });
      engine.current?.cancelSearch();
    }
    return true;
  }, [dispatchSession, session]);

  const boardMove = useCallback((orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || !humanCanMove(pos)) return;
    const square = parseSquare(orig);
    const piece = square === undefined ? undefined : pos.board.get(square);
    if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
      setPromotion({ orig, dest });
      return;
    }
    const move = parseUci(`${orig}${dest}`);
    if (move) finishMove(move, orig, dest);
  }, [finishMove, humanCanMove]);

  const promote = useCallback((role: LocalPromotionRole) => {
    if (!promotion) return;
    const suffix = role === 'queen' ? 'q' : role === 'rook' ? 'r' : role === 'bishop' ? 'b' : 'n';
    const pending = promotion;
    setPromotion(null);
    const move = parseUci(`${pending.orig}${pending.dest}${suffix}`);
    if (move) finishMove(move, pending.orig, pending.dest);
  }, [finishMove, promotion]);

  useEffect(() => {
    if (mode !== 'ai' || positionId === null) {
      setEngineStatus('off');
      return;
    }
    let cancelled = false;
    setEngineStatus('loading');
    void ensureEngine()
      .then(value => value.init())
      .then(() => { if (!cancelled) setEngineStatus('ready'); })
      .catch(error => {
        if (!cancelled) {
          setEngineStatus('error');
          setEngineError(error instanceof Error ? error.message : 'Stockfish failed to load.');
        }
      });
    return () => { cancelled = true; };
  }, [ensureEngine, mode, positionId]);

  useEffect(() => {
    if (session.state !== 'COUNTDOWN') return;
    if (session.countdownMs <= 0) {
      setFastForward(false);
      dispatchSession({ type: 'TRANSITION', to: 'ACTIVE' });
      return;
    }
    const delay = fastForward ? 250 : 1000;
    const timer = window.setTimeout(() => dispatchSession({ type: 'COUNTDOWN_TICK', elapsedMs: 1000 }), delay);
    return () => window.clearTimeout(timer);
  }, [dispatchSession, fastForward, session.countdownMs, session.state]);

  useEffect(() => {
    if (session.state !== 'ACTIVE' || !activeColor) return;
    if (mode === 'ai' && activeColor === aiColor && engineStatus === 'loading') return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const current = performance.now();
      const elapsedMs = Math.max(0, current - previous);
      previous = current;
      if (elapsedMs > 0) dispatchSession({ type: 'CLOCK_TICK', elapsedMs, at: Date.now() });
    }, 100);
    return () => window.clearInterval(timer);
  }, [activeColor, aiColor, dispatchSession, engineStatus, mode, session.state]);

  useEffect(() => {
    if (!session.resultKind || terminalSoundPlayed.current) return;
    terminalSoundPlayed.current = true;
    engine.current?.cancelSearch();
    playChessSound('win');
  }, [session.resultKind]);

  useEffect(() => {
    const pos = position.current;
    if (session.state !== 'ACTIVE' || mode !== 'ai' || !aiColor || !pos || session.pendingClockPress || session.sideToMove !== aiColor || session.result) return;
    let cancelled = false;
    const snapshot = session.fen;
    const run = async () => {
      try {
        const value = await ensureEngine();
        if (!value.isReady()) { setEngineStatus('loading'); await value.init(); }
        if (cancelled) return;
        setEngineStatus('thinking');
        const uci = await value.bestMove(snapshot, difficulty);
        if (cancelled) return;
        const current = position.current;
        if (!current || current.turn !== aiColor || makeFen(current.toSetup()) !== snapshot) return;
        const move = parseUci(uci);
        if (!move || !current.isLegal(move)) throw new Error('Stockfish returned an invalid move.');
        finishMove(move, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key);
        setEngineStatus('ready');
      } catch (error) {
        if (!cancelled) {
          setEngineStatus('error');
          setEngineError(error instanceof Error ? error.message : 'Stockfish could not move.');
        }
      }
    };
    void run();
    return () => { cancelled = true; engine.current?.cancelSearch(); };
  }, [aiColor, difficulty, ensureEngine, finishMove, mode, session.fen, session.pendingClockPress, session.result, session.sideToMove, session.state]);

  useEffect(() => {
    if (session.state !== 'ACTIVE' || mode !== 'ai' || !aiColor || !session.pendingClockPress) return;
    const delay = session.pendingClockPress === aiColor ? 220 : 120;
    const timer = window.setTimeout(() => dispatchSession({ type: 'CLOCK_TRANSFERRED' }), delay);
    return () => window.clearTimeout(timer);
  }, [aiColor, dispatchSession, mode, session.pendingClockPress, session.state]);

  useEffect(() => () => engine.current?.destroy(), []);

  const startNow = useCallback(() => {
    if (session.state !== 'COUNTDOWN') return;
    dispatchSession({ type: 'SET_COUNTDOWN', remainingMs: 0 });
    dispatchSession({ type: 'TRANSITION', to: 'ACTIVE' });
    setFastForward(false);
    playChessSound('start');
  }, [dispatchSession, session.state]);

  const slapClock = useCallback(() => {
    if (!session.pendingClockPress || session.state !== 'ACTIVE') return;
    dispatchSession({ type: 'CLOCK_TRANSFERRED' });
  }, [dispatchSession, session.pendingClockPress, session.state]);

  const agreeDraw = useCallback((by: Color) => {
    if (session.state !== 'ACTIVE') return;
    const other = opposite(by);
    dispatchSession({ type: 'OFFER_DRAW', by });
    dispatchSession({ type: 'OFFER_DRAW', by: other });
    dispatchSession({ type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null });
  }, [dispatchSession, session.state]);

  const resign = useCallback((by: Color) => {
    if (session.state !== 'ACTIVE') return;
    dispatchSession({ type: 'RESIGN', by });
  }, [dispatchSession, session.state]);

  const playerName = useCallback((color: Color) => mode === 'ai' && aiColor === color
    ? `Stockfish · ${LOCAL_DIFFICULTIES[difficulty].label}`
    : mode === 'ai' ? 'You' : color === 'white' ? 'White' : 'Black', [aiColor, difficulty, mode]);

  const connectionFor = useCallback((color: Color) => {
    if (mode !== 'ai' || aiColor !== color) return 'Local';
    if (engineStatus === 'thinking') return 'Thinking';
    if (engineStatus === 'loading') return 'Loading';
    if (engineStatus === 'error') return 'Engine error';
    return 'Ready';
  }, [aiColor, engineStatus, mode]);

  const ratingFor = useCallback((color: Color) => mode === 'ai' && aiColor === color ? LOCAL_DIFFICULTIES[difficulty].label : 'Unrated', [aiColor, difficulty, mode]);

  return {
    session,
    phase,
    mode,
    setMode,
    orientation,
    setOrientation,
    difficulty,
    setDifficulty,
    sideChoice,
    setSideChoice,
    timeControl,
    setTimeControl,
    engineStatus,
    engineError,
    positionId,
    fen,
    turn,
    moves,
    backRank,
    humanColor,
    aiColor,
    movableColor,
    legalDests,
    lastMove,
    promotion,
    whiteClockMs: session.clocks.whiteMs,
    blackClockMs: session.clocks.blackMs,
    activeColor,
    pendingSlap,
    fastForward,
    setFastForward,
    createPosition,
    boardMove,
    promote,
    startNow,
    slapClock,
    agreeDraw,
    resign,
    playerName,
    connectionFor,
    ratingFor,
  };
}
