import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, Role } from 'chessops/types';
import { parseSquare, parseUci } from 'chessops/util';
import { chess960BackRank, chess960Fen, randomChess960Id } from './game/chess960';
import { playChessSound } from './ui/sound';
import { motionTokenMs, useReducedMotion } from './ui/motion';
import ChessClock2D from './ui/ChessClock2D';
import MatchPlayerBar from './ui/MatchPlayerBar';
import ChessBoardSurface, { type QQurzChessgroundApi, type QQurzChessgroundConfig } from './ui/ChessBoardSurface';
import ChessPieceAsset from './ui/ChessPieceAsset';

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
  const ground = useRef<QQurzChessgroundApi | null>(null);
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
  const [pendingSlap, setPendingSlap] = useState<Color | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);
  const reducedMotion = useReducedMotion();
  const pieceMotionMs = reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 160);

  const ensureEngine = useCallback(async (): Promise<Engine> => {
    if (engine.current) return engine.current;
    if (!enginePromise.current) {
      enginePromise.current = import('./engine/stockfish').then(({ StockfishEngine }) => {
        const value = new StockfishEngine() as Engine;
        engine.current = value;
        return value;
      });
    }
    return engine.current ?? enginePromise.current;
  }, []);

  const humanCanMove = useCallback((pos: Chess) => {
    if (phase !== 'playing' || pendingSlap) return false;
    return mode === 'human' || humanColor === pos.turn;
  }, [humanColor, mode, pendingSlap, phase]);

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
      animation: { enabled: !reducedMotion, duration: pieceMotionMs },
      draggable: { enabled: canMove, showGhost: true, autoDistance: true },
      selectable: { enabled: canMove },
      movable: {
        free: false,
        color: canMove ? pos.turn : undefined,
        dests: canMove ? chessgroundDests(pos, { chess960: true }) : new Map(),
        rookCastle: true,
        showDests: true,
      },
    });
  }, [humanCanMove, lastMove, orientation, pieceMotionMs, reducedMotion]);

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
    setPendingSlap(null);
    setEngineError('');
    setPhase('strategy');
  }, [mode, sideChoice]);

  const finishMove = useCallback((move: Move, orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || phase !== 'playing' || pendingSlap || !pos.isLegal(move)) {
      requestAnimationFrame(syncBoard);
      return false;
    }
    const movingColor = pos.turn;
    const fromSquare = parseSquare(orig);
    const toSquare = parseSquare(dest);
    const movingPiece = fromSquare === undefined ? undefined : pos.board.get(fromSquare);
    const capturedPiece = toSquare === undefined ? undefined : pos.board.get(toSquare);
    const isCapture = Boolean(capturedPiece) || Boolean(movingPiece?.role === 'pawn' && orig[0] !== dest[0]);
    const san = makeSan(pos, move);
    pos.play(move);
    playChessSound(isCapture ? 'capture' : 'move');
    setFen(makeFen(pos.toSetup()));
    setTurn(pos.turn);
    setLastMove([orig, dest]);
    setMoves(values => [...values, san]);
    const ending = gameResult(pos);
    if (ending) {
      setResult(ending);
      setPhase('ended');
      setPendingSlap(null);
      playChessSound('win');
      engine.current?.cancelSearch();
    } else {
      setPendingSlap(movingColor);
    }
    return true;
  }, [pendingSlap, phase, syncBoard]);

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
      const clockOwner = pendingSlap ?? pos.turn;
      if (mode === 'ai' && clockOwner === aiColor && engineStatus === 'loading') return;
      const setter = clockOwner === 'white' ? setWhiteClock : setBlackClock;
      setter(value => {
        const next = Math.max(0, value - 1);
        if (next === 0) {
          setResult(clockOwner === 'white' ? 'Black wins on time' : 'White wins on time');
          setPhase('ended');
          setPendingSlap(null);
          playChessSound('win');
          engine.current?.cancelSearch();
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [aiColor, engineStatus, mode, pendingSlap, phase]);

  useEffect(() => {
    const pos = position.current;
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pos || pendingSlap || pos.turn !== aiColor || result) return;
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
  }, [aiColor, difficulty, ensureEngine, fen, finishMove, mode, pendingSlap, phase, result, turn]);

  useEffect(() => {
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || pendingSlap !== aiColor) return;
    const timer = window.setTimeout(() => {
      playChessSound('slap');
      setPendingSlap(null);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [aiColor, mode, pendingSlap, phase]);

  useEffect(() => () => engine.current?.destroy(), []);

  const startNow = () => { if (phase === 'strategy') { setStrategyTime(0); setFastForward(false); setPhase('playing'); playChessSound('start'); } };
  const slapClock = useCallback(() => {
    if (!pendingSlap || phase !== 'playing') return;
    playChessSound('slap');
    setPendingSlap(null);
  }, [pendingSlap, phase]);
  const playerName = (color: Color) => mode === 'ai' && aiColor === color ? `Stockfish · ${DIFFICULTIES[difficulty].label}` : mode === 'ai' ? 'You' : color === 'white' ? 'White' : 'Black';
  const topColor = opposite(orientation);
  const bottomColor = orientation;
  const clockFor = (color: Color) => formatClock(color === 'white' ? whiteClock : blackClock);
  const activeColor = phase === 'playing' ? (pendingSlap ?? turn) : null;
  const connectionFor = (color: Color) => {
    if (mode !== 'ai' || aiColor !== color) return 'Local';
    if (engineStatus === 'thinking') return 'Thinking';
    if (engineStatus === 'loading') return 'Loading';
    if (engineStatus === 'error') return 'Engine error';
    return 'Ready';
  };
  const ratingFor = (color: Color) => mode === 'ai' && aiColor === color ? DIFFICULTIES[difficulty].label : 'Unrated';
  const finishLocalGame = (text: string) => {
    if (phase !== 'playing') return;
    setResult(text);
    setPhase('ended');
    setPendingSlap(null);
    engine.current?.cancelSearch();
    playChessSound('win');
  };
  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen,
    orientation,
    coordinates: true,
    coordinatesOnSquares: true,
    autoCastle: true,
    blockTouchScroll: true,
    disableContextMenu: true,
    movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
  }), [fen, orientation]);

  if (phase === 'setup') {
    return (
      <section className="local-fast-shell setup-only">
        <div className="local-fast-setup">
          <span className="qqurz-kicker">LOCAL PLAY</span>
          <h1>{mode === 'ai' ? 'Play Stockfish.' : 'Play together.'}</h1>
          <p>Choose your game. Then the board takes over — no dashboard, no clutter.</p>

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

          <button className="primary-black local-start" onClick={createPosition}>Start game</button>
        </div>
      </section>
    );
  }

  return (
    <section className="local-fast-shell local-chess-layout">
      <div className="match-board-stack">
        <div className="match-game-meta">
          <b>Chess960 · #{positionId}</b>
          <span>{mode === 'ai' ? `You vs ${DIFFICULTIES[difficulty].label} Stockfish` : 'Same-device game'}</span>
        </div>

        {mode === 'ai' && <div className={`local-engine-state match-engine-state ${engineStatus}`}>{engineStatus === 'loading' ? 'Loading Stockfish…' : engineStatus === 'thinking' ? 'Stockfish thinking…' : engineStatus === 'ready' ? 'Stockfish ready' : engineError || 'AI preparing'}</div>}

        <MatchPlayerBar
          color={topColor}
          name={playerName(topColor)}
          rating={ratingFor(topColor)}
          connection={connectionFor(topColor)}
          connected={mode !== 'ai' || aiColor !== topColor || engineStatus !== 'error'}
          time={clockFor(topColor)}
          fen={fen}
          active={activeColor === topColor}
        />

        <div className="local-board-frame match-board-frame">
          <ChessBoardSurface
            apiRef={ground}
            instanceKey={positionId ?? 'local'}
            config={boardConfig}
            ariaLabel="Interactive Chess960 board"
            onReady={() => syncBoard()}
          />
          {phase === 'strategy' && (
            <div className="local-board-overlay">
              <span>STRATEGY</span>
              <strong>{formatClock(strategyTime)}</strong>
              <p>Green dots show legal destinations. Take your time, then start when you are ready.</p>
              <div>
                <button onPointerDown={() => setFastForward(true)} onPointerUp={() => setFastForward(false)} onPointerCancel={() => setFastForward(false)}>Hold ×4</button>
                <button className="primary-black" onClick={startNow}>Start game</button>
              </div>
            </div>
          )}
          {phase === 'ended' && result && (
            <div className="local-board-overlay ended"><span>GAME OVER</span><strong className="end-title">{result}</strong><button className="primary-black" onClick={createPosition}>New position</button></div>
          )}
        </div>

        <MatchPlayerBar
          color={bottomColor}
          name={playerName(bottomColor)}
          rating={ratingFor(bottomColor)}
          connection={connectionFor(bottomColor)}
          connected={mode !== 'ai' || aiColor !== bottomColor || engineStatus !== 'error'}
          time={clockFor(bottomColor)}
          fen={fen}
          active={activeColor === bottomColor}
          self
        />

        <ChessClock2D
          whiteSeconds={whiteClock}
          blackSeconds={blackClock}
          activeColor={activeColor}
          pendingSlap={pendingSlap}
          disabled={!pendingSlap || pendingSlap === aiColor}
          onSlap={slapClock}
        />

        <div className="match-controls" aria-label="Game controls">
          <div className={`match-turn-note ${activeColor === bottomColor ? 'active' : ''}`}>
            {phase === 'strategy' ? 'Strategy phase' : phase === 'ended' ? result : pendingSlap === bottomColor ? 'Move made — press your clock' : activeColor === bottomColor ? 'Your move' : 'Opponent move'}
          </div>
          <button onClick={() => finishLocalGame('Draw by agreement')} disabled={phase !== 'playing'}>Draw</button>
          <button className="match-resign" onClick={() => finishLocalGame(`${opposite(bottomColor) === 'white' ? 'White' : 'Black'} wins by resignation`)} disabled={phase !== 'playing'}>Resign</button>
          <button aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>Options</button>
        </div>

        {optionsOpen && (
          <section className="match-options-panel" aria-label="Match options">
            <div><span>Position</span><b>Chess960 #{positionId}</b></div>
            <div><span>Back rank</span><b>{backRank}</b></div>
            <div><span>Moves</span><b>{moves.length}</b></div>
            <div className="match-options-actions">
              <button onClick={() => setOrientation(value => opposite(value))}>Flip board</button>
              <button onClick={createPosition} disabled={phase === 'playing'}>{phase === 'playing' ? 'Position locked' : 'New position'}</button>
            </div>
            <div className="match-move-list">
              <span className="qqurz-kicker">MOVES</span>
              {moves.length ? <ol>{moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}
            </div>
          </section>
        )}
      </div>

      {promotion && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
          <div className="promotion-modal">
            <span className="qqurz-kicker">PROMOTION</span>
            <h2>Choose a piece</h2>
            <div className="promotion-grid">
              <button onClick={() => promote('queen')}><ChessPieceAsset role="queen" color={turn} size="lg" /><span>Queen</span></button>
              <button onClick={() => promote('rook')}><ChessPieceAsset role="rook" color={turn} size="lg" /><span>Rook</span></button>
              <button onClick={() => promote('bishop')}><ChessPieceAsset role="bishop" color={turn} size="lg" /><span>Bishop</span></button>
              <button onClick={() => promote('knight')}><ChessPieceAsset role="knight" color={turn} size="lg" /><span>Knight</span></button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
