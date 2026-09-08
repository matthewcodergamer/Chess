import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';
import type { Color, Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, Role } from 'chessops/types';
import { parseSquare, parseUci } from 'chessops/util';
import { chess960BackRank, chess960Fen, randomChess960Id } from './game/chess960';

type GameMode = 'human' | 'ai';
type Phase = 'setup' | 'strategy' | 'playing' | 'ended';
type Difficulty = 'easy' | 'hard' | 'crazy';
type SideChoice = 'white' | 'black' | 'random';
type PromotionRole = Extract<Role, 'queen' | 'rook' | 'bishop' | 'knight'>;
type EngineStatus = 'off' | 'loading' | 'ready' | 'thinking' | 'error';

type Engine = {
  init: () => Promise<void>;
  isReady: () => boolean;
  bestMove: (fen: string, difficulty: Difficulty) => Promise<string>;
  cancelSearch: () => void;
  destroy: () => void;
};

type Props = { initialMode: GameMode };

const GAME_SECONDS = 10 * 60;
const STRATEGY_SECONDS = 120;
const DIFFICULTIES: Record<Difficulty, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Relaxed and forgiving' },
  hard: { label: 'Hard', note: 'Strong club-level play' },
  crazy: { label: 'Crazy Hard', note: 'Stockfish at full skill' },
};

function formatClock(value: number): string {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }
function chooseColor(choice: SideChoice): Color { return choice === 'random' ? (Math.random() < .5 ? 'white' : 'black') : choice; }

function gameResult(pos: Chess): string | null {
  if (pos.isCheckmate()) return pos.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (pos.isStalemate()) return 'Draw by stalemate';
  if (pos.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (pos.isEnd()) return 'Game over';
  return null;
}

export default function LocalGame({ initialMode }: Props) {
  const boardNode = useRef<HTMLDivElement | null>(null);
  const ground = useRef<ChessgroundApi | null>(null);
  const position = useRef<Chess | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});
  const engine = useRef<Engine | null>(null);
  const enginePromise = useRef<Promise<Engine> | null>(null);

  const [mode, setMode] = useState<GameMode>(initialMode);
  const [phase, setPhase] = useState<Phase>('setup');
  const [positionId, setPositionId] = useState<number | null>(null);
  const [fen, setFen] = useState('');
  const [turn, setTurn] = useState<Color>('white');
  const [orientation, setOrientation] = useState<Color>('white');
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [moves, setMoves] = useState<string[]>([]);
  const [whiteClock, setWhiteClock] = useState(GAME_SECONDS);
  const [blackClock, setBlackClock] = useState(GAME_SECONDS);
  const [strategyTime, setStrategyTime] = useState(STRATEGY_SECONDS);
  const [fastForward, setFastForward] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('hard');
  const [sideChoice, setSideChoice] = useState<SideChoice>('white');
  const [humanColor, setHumanColor] = useState<Color | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('off');
  const [engineError, setEngineError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);

  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);

  const ensureEngine = useCallback(async (): Promise<Engine> => {
    if (engine.current) return engine.current;
    if (!enginePromise.current) {
      enginePromise.current = import('./engine/stockfish').then(({ StockfishEngine }) => {
        const value = new StockfishEngine() as Engine;
        engine.current = value;
        return value;
      });
    }
    return enginePromise.current;
  }, []);

  const humanCanMove = useCallback((pos: Chess) => {
    if (phase !== 'playing') return false;
    return mode === 'human' || humanColor === pos.turn;
  }, [humanColor, mode, phase]);

  const syncBoard = useCallback(() => {
    const pos = position.current;
    const api = ground.current;
    if (!pos || !api) return;
    const canMove = humanCanMove(pos);
    api.set({
      fen: makeFen(pos.toSetup()),
      orientation,
      turnColor: pos.turn,
      check: false,
      lastMove,
      animation: { enabled: true, duration: 150 },
      draggable: { enabled: canMove, showGhost: true, autoDistance: true },
      selectable: { enabled: canMove },
      movable: {
        free: false,
        color: canMove ? pos.turn : undefined,
        dests: canMove ? chessgroundDests(pos, { chess960: true }) : new Map(),
        rookCastle: true,
        showDests: false,
      },
    });
  }, [humanCanMove, lastMove, orientation]);

  const createPosition = useCallback(() => {
    const id = randomChess960Id();
    const pos = Chess.fromSetup(parseFen(chess960Fen(id)).unwrap()).unwrap();
    const chosen = mode === 'ai' ? chooseColor(sideChoice) : null;
    position.current = pos;
    setPositionId(id);
    setFen(makeFen(pos.toSetup()));
    setTurn('white');
    setOrientation(chosen ?? 'white');
    setHumanColor(chosen);
    setMoves([]);
    setLastMove(undefined);
    setWhiteClock(GAME_SECONDS);
    setBlackClock(GAME_SECONDS);
    setStrategyTime(STRATEGY_SECONDS);
    setFastForward(false);
    setResult(null);
    setPromotion(null);
    setEngineError('');
    setPhase('strategy');
  }, [mode, sideChoice]);

  const finishMove = useCallback((move: Move, orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || phase !== 'playing' || !pos.isLegal(move)) {
      requestAnimationFrame(syncBoard);
      return false;
    }
    const san = makeSan(pos, move);
    pos.play(move);
    setFen(makeFen(pos.toSetup()));
    setTurn(pos.turn);
    setLastMove([orig, dest]);
    setMoves(values => [...values, san]);
    const ending = gameResult(pos);
    if (ending) {
      setResult(ending);
      setPhase('ended');
      engine.current?.cancelSearch();
    }
    return true;
  }, [phase, syncBoard]);

  const boardMove = useCallback((orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || !humanCanMove(pos)) return requestAnimationFrame(syncBoard);
    const square = parseSquare(orig);
    const piece = square === undefined ? undefined : pos.board.get(square);
    if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
      setPromotion({ orig, dest });
      return requestAnimationFrame(syncBoard);
    }
    const move = parseUci(`${orig}${dest}`);
    if (!move) return requestAnimationFrame(syncBoard);
    finishMove(move, orig, dest);
  }, [finishMove, humanCanMove, syncBoard]);
  moveHandler.current = boardMove;

  const promote = (role: PromotionRole) => {
    if (!promotion) return;
    const suffix = role === 'queen' ? 'q' : role === 'rook' ? 'r' : role === 'bishop' ? 'b' : 'n';
    const move = parseUci(`${promotion.orig}${promotion.dest}${suffix}`);
    const pending = promotion;
    setPromotion(null);
    if (move) finishMove(move, pending.orig, pending.dest);
  };

  useEffect(() => {
    if (positionId === null || !boardNode.current) return;
    ground.current?.destroy();
    ground.current = Chessground(boardNode.current, {
      orientation,
      coordinates: true,
      coordinatesOnSquares: true,
      autoCastle: true,
      blockTouchScroll: true,
      disableContextMenu: true,
      movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
    });
    syncBoard();
    const resize = new ResizeObserver(() => ground.current?.redrawAll());
    resize.observe(boardNode.current);
    return () => { resize.disconnect(); ground.current?.destroy(); ground.current = null; };
  }, [positionId]);

  useEffect(() => { syncBoard(); }, [fen, orientation, phase, syncBoard, turn]);

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
    if (phase !== 'strategy') return;
    if (strategyTime <= 0) {
      setFastForward(false);
      setPhase('playing');
      return;
    }
    const delay = fastForward ? 250 : 1000;
    const timer = window.setTimeout(() => setStrategyTime(value => Math.max(0, value - 1)), delay);
    return () => window.clearTimeout(timer);
  }, [fastForward, phase, strategyTime]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      const pos = position.current;
      if (!pos) return;
      if (mode === 'ai' && pos.turn === aiColor && engineStatus === 'loading') return;
      const setter = pos.turn === 'white' ? setWhiteClock : setBlackClock;
      setter(value => {
        const next = Math.max(0, value - 1);
        if (next === 0) {
          setResult(pos.turn === 'white' ? 'Black wins on time' : 'White wins on time');
          setPhase('ended');
          engine.current?.cancelSearch();
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [aiColor, engineStatus, mode, phase]);

  useEffect(() => {
    const pos = position.current;
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pos || pos.turn !== aiColor || result) return;
    let cancelled = false;
    const snapshot = makeFen(pos.toSetup());
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
  }, [aiColor, difficulty, ensureEngine, fen, finishMove, mode, phase, result, turn]);

  useEffect(() => () => engine.current?.destroy(), []);

  const startNow = () => { if (phase === 'strategy') { setStrategyTime(0); setFastForward(false); setPhase('playing'); } };
  const playerName = (color: Color) => mode === 'ai' && aiColor === color ? `Stockfish · ${DIFFICULTIES[difficulty].label}` : mode === 'ai' ? 'You' : color === 'white' ? 'White' : 'Black';

  if (phase === 'setup') {
    return (
      <section className="local-fast-shell setup-only">
        <div className="local-fast-setup">
          <span className="qqurz-kicker">LOCAL PLAY</span>
          <h1>{mode === 'ai' ? 'Play Stockfish.' : 'Play together.'}</h1>
          <p>The board opens immediately. Stockfish is not downloaded until an AI position is created.</p>

          <div className="local-mode-switch" role="radiogroup" aria-label="Game mode">
            <button className={mode === 'human' ? 'selected' : ''} onClick={() => setMode('human')}>Human vs Human</button>
            <button className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}>Play AI</button>
          </div>

          {mode === 'ai' && (
            <div className="local-ai-options">
              <div>
                <span>AI strength</span>
                <div className="option-pills">
                  {(Object.keys(DIFFICULTIES) as Difficulty[]).map(level => (
                    <button key={level} className={difficulty === level ? 'selected' : ''} onClick={() => setDifficulty(level)}>
                      <b>{DIFFICULTIES[level].label}</b><small>{DIFFICULTIES[level].note}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span>Play as</span>
                <div className="side-pills">
                  {(['white', 'black', 'random'] as SideChoice[]).map(side => (
                    <button key={side} className={sideChoice === side ? 'selected' : ''} onClick={() => setSideChoice(side)}>{side[0].toUpperCase() + side.slice(1)}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <button className="primary-black local-start" onClick={createPosition}>Create Position</button>
        </div>
      </section>
    );
  }

  return (
    <section className="local-fast-shell">
      <aside className="local-fast-side">
        <div>
          <span className="qqurz-kicker">POSITION #{positionId}</span>
          <h2>{backRank}</h2>
          <p>{mode === 'ai' ? `You vs ${DIFFICULTIES[difficulty].label} Stockfish` : 'Human vs Human'}</p>
        </div>
        <div className="local-clocks">
          <div className={turn === 'black' && phase === 'playing' ? 'active' : ''}><span>{playerName('black')}</span><strong>{formatClock(blackClock)}</strong></div>
          <div className={turn === 'white' && phase === 'playing' ? 'active' : ''}><span>{playerName('white')}</span><strong>{formatClock(whiteClock)}</strong></div>
        </div>
        {mode === 'ai' && <div className={`local-engine-state ${engineStatus}`}>{engineStatus === 'loading' ? 'Loading Stockfish in background…' : engineStatus === 'thinking' ? 'Stockfish thinking…' : engineStatus === 'ready' ? 'Stockfish ready' : engineError || 'AI preparing'}</div>}
        <div className="local-side-actions">
          <button onClick={() => setOrientation(value => opposite(value))}>Flip board</button>
          <button onClick={createPosition} disabled={phase === 'playing'}>{phase === 'playing' ? 'Pattern locked' : 'Choose Pattern'}</button>
        </div>
        <div className="local-moves">
          <span>Moves</span>
          {moves.length ? <ol>{moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}
        </div>
      </aside>

      <div className="local-board-area">
        <div className="local-board-frame no-free-hints">
          <div ref={boardNode} className="cg-wrap board-mount" aria-label="Interactive Chess960 board" />
          {phase === 'strategy' && (
            <div className="local-board-overlay">
              <span>STRATEGY</span>
              <strong>{formatClock(strategyTime)}</strong>
              <p>No free tactical warnings or legal-move dots are shown. Legal blunders are yours to make.</p>
              <div>
                <button onPointerDown={() => setFastForward(true)} onPointerUp={() => setFastForward(false)} onPointerCancel={() => setFastForward(false)}>Hold ×4</button>
                <button className="primary-black" onClick={startNow}>Start Now</button>
              </div>
            </div>
          )}
          {phase === 'ended' && result && (
            <div className="local-board-overlay ended"><span>GAME OVER</span><strong className="end-title">{result}</strong><button className="primary-black" onClick={createPosition}>New position</button></div>
          )}
        </div>
        <div className="local-mobile-clocks">
          <div><span>{playerName('white')}</span><strong>{formatClock(whiteClock)}</strong></div>
          <div><span>{playerName('black')}</span><strong>{formatClock(blackClock)}</strong></div>
        </div>
      </div>

      {promotion && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
          <div className="promotion-modal">
            <span className="qqurz-kicker">PROMOTION</span>
            <h2>Choose a piece</h2>
            <div className="promotion-grid">
              <button onClick={() => promote('queen')}>♕ Queen</button>
              <button onClick={() => promote('rook')}>♖ Rook</button>
              <button onClick={() => promote('bishop')}>♗ Bishop</button>
              <button onClick={() => promote('knight')}>♘ Knight</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
