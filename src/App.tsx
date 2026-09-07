import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';
import type { Color as GroundColor, Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, Role } from 'chessops/types';
import { parseSquare, parseUci } from 'chessops/util';
import { chess960BackRank, chess960Fen, randomChess960Id } from './game/chess960';
import { AI_DIFFICULTIES, StockfishEngine, type AiDifficulty } from './engine/stockfish';

const STRATEGY_SECONDS = 120;
const GAME_SECONDS = 10 * 60;
const FAST_FORWARD_RATE = 4;

type Phase = 'idle' | 'strategy' | 'playing' | 'ended';
type PromotionRole = Extract<Role, 'queen' | 'rook' | 'bishop' | 'knight'>;
type GameMode = 'human' | 'ai';
type SideChoice = 'white' | 'black' | 'random';
type EngineStatus = 'off' | 'loading' | 'ready' | 'thinking' | 'error';

type PendingPromotion = {
  orig: Key;
  dest: Key;
} | null;

const promotionLetters: Record<PromotionRole, string> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function resultText(position: Chess): string | null {
  if (position.isCheckmate()) {
    return position.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  }
  if (position.isStalemate()) return 'Draw by stalemate';
  if (position.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (position.isEnd()) return 'Game over';
  return null;
}

function opposite(color: GroundColor): GroundColor {
  return color === 'white' ? 'black' : 'white';
}

function resolveSide(choice: SideChoice): GroundColor {
  if (choice === 'random') return Math.random() < 0.5 ? 'white' : 'black';
  return choice;
}

type FastForwardButtonProps = {
  active: boolean;
  onStart: () => void;
  onStop: () => void;
  onTap: () => void;
  compact?: boolean;
};

function FastForwardButton({ active, onStart, onStop, onTap, compact = false }: FastForwardButtonProps) {
  return (
    <button
      type="button"
      className={`fast-forward-button ${active ? 'active' : ''} ${compact ? 'compact' : ''}`}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onStart();
      }}
      onPointerUp={onStop}
      onPointerCancel={onStop}
      onBlur={onStop}
      onKeyDown={event => {
        if (event.key === ' ' || event.key === 'Enter') onStart();
      }}
      onKeyUp={event => {
        if (event.key === ' ' || event.key === 'Enter') onStop();
      }}
      onClick={onTap}
      aria-pressed={active}
    >
      <span aria-hidden="true">⏩</span>
      {compact ? `Hold ×${FAST_FORWARD_RATE}` : `Hold to fast-forward ×${FAST_FORWARD_RATE} · tap skips 10s`}
    </button>
  );
}

export default function App() {
  const boardElement = useRef<HTMLDivElement | null>(null);
  const ground = useRef<ChessgroundApi | null>(null);
  const position = useRef<Chess | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});
  const stockfish = useRef<StockfishEngine | null>(null);

  const [positionId, setPositionId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [strategyTime, setStrategyTime] = useState(STRATEGY_SECONDS);
  const [fastForwarding, setFastForwarding] = useState(false);
  const [orientation, setOrientation] = useState<GroundColor>('white');
  const [fen, setFen] = useState('');
  const [turn, setTurn] = useState<GroundColor>('white');
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [moves, setMoves] = useState<string[]>([]);
  const [whiteClock, setWhiteClock] = useState(GAME_SECONDS);
  const [blackClock, setBlackClock] = useState(GAME_SECONDS);
  const [endMessage, setEndMessage] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion>(null);

  const [gameMode, setGameMode] = useState<GameMode>('human');
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('hard');
  const [sideChoice, setSideChoice] = useState<SideChoice>('white');
  const [humanColor, setHumanColor] = useState<GroundColor | null>(null);
  const [aiStatus, setAiStatus] = useState<EngineStatus>('off');
  const [aiError, setAiError] = useState('');

  const aiColor = useMemo(
    () => (gameMode === 'ai' && humanColor ? opposite(humanColor) : null),
    [gameMode, humanColor],
  );

  const backRank = useMemo(
    () => (positionId === null ? null : chess960BackRank(positionId)),
    [positionId],
  );

  const ensureStockfish = useCallback(() => {
    if (!stockfish.current) stockfish.current = new StockfishEngine();
    return stockfish.current;
  }, []);

  const canHumanMove = useCallback((pos: Chess) => {
    if (phase !== 'playing') return false;
    if (gameMode === 'human') return true;
    return humanColor === pos.turn;
  }, [gameMode, humanColor, phase]);

  const syncBoard = useCallback(() => {
    const pos = position.current;
    const api = ground.current;
    if (!pos || !api) return;

    const humanTurn = canHumanMove(pos);
    api.set({
      fen: makeFen(pos.toSetup()),
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      lastMove,
      viewOnly: phase === 'idle',
      animation: { enabled: true, duration: 170 },
      draggable: {
        enabled: humanTurn,
        showGhost: true,
        autoDistance: true,
      },
      selectable: { enabled: humanTurn },
      movable: {
        free: false,
        color: humanTurn ? pos.turn : undefined,
        dests: humanTurn ? chessgroundDests(pos, { chess960: true }) : new Map(),
        showDests: true,
        rookCastle: true,
      },
    });
  }, [canHumanMove, lastMove, orientation, phase]);

  const beginPosition = useCallback((id: number, keepHumanColor?: GroundColor | null) => {
    const setup = parseFen(chess960Fen(id)).unwrap();
    const nextPosition = Chess.fromSetup(setup).unwrap();
    const resolvedHuman = gameMode === 'ai'
      ? (keepHumanColor ?? resolveSide(sideChoice))
      : null;

    position.current = nextPosition;
    setPositionId(id);
    setFen(makeFen(nextPosition.toSetup()));
    setTurn('white');
    setPhase('strategy');
    setStrategyTime(STRATEGY_SECONDS);
    setFastForwarding(false);
    setMoves([]);
    setLastMove(undefined);
    setWhiteClock(GAME_SECONDS);
    setBlackClock(GAME_SECONDS);
    setEndMessage(null);
    setPendingPromotion(null);
    setHumanColor(resolvedHuman);
    setOrientation(resolvedHuman ?? 'white');
    setAiError('');
    stockfish.current?.cancelSearch();
  }, [gameMode, sideChoice]);

  const shuffleMatch = useCallback(() => beginPosition(randomChess960Id()), [beginPosition]);

  const startGameNow = useCallback(() => {
    if (position.current && phase === 'strategy') {
      setStrategyTime(0);
      setFastForwarding(false);
      setPhase('playing');
    }
  }, [phase]);

  const skipStrategy = useCallback(() => {
    setStrategyTime(value => Math.max(0, value - 10));
  }, []);

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
    setMoves(history => [...history, san]);

    const ending = resultText(pos);
    if (ending) {
      setEndMessage(ending);
      setPhase('ended');
      setFastForwarding(false);
    }
    return true;
  }, [phase, syncBoard]);

  const handleBoardMove = useCallback((orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || !canHumanMove(pos)) {
      requestAnimationFrame(syncBoard);
      return;
    }

    const origSquare = parseSquare(orig);
    const movingPiece = origSquare === undefined ? undefined : pos.board.get(origSquare);
    const destinationRank = dest[1];

    if (
      movingPiece?.role === 'pawn' &&
      ((movingPiece.color === 'white' && destinationRank === '8') ||
        (movingPiece.color === 'black' && destinationRank === '1'))
    ) {
      setPendingPromotion({ orig, dest });
      requestAnimationFrame(syncBoard);
      return;
    }

    const move = parseUci(`${orig}${dest}`);
    if (!move) {
      requestAnimationFrame(syncBoard);
      return;
    }

    finishMove(move, orig, dest);
  }, [canHumanMove, finishMove, syncBoard]);

  moveHandler.current = handleBoardMove;

  const choosePromotion = useCallback((role: PromotionRole) => {
    if (!pendingPromotion) return;
    const { orig, dest } = pendingPromotion;
    setPendingPromotion(null);
    const move = parseUci(`${orig}${dest}${promotionLetters[role]}`);
    if (!move) {
      requestAnimationFrame(syncBoard);
      return;
    }
    finishMove(move, orig, dest);
  }, [finishMove, pendingPromotion, syncBoard]);

  useEffect(() => {
    if (gameMode !== 'ai') {
      setAiStatus('off');
      setAiError('');
      return;
    }

    let cancelled = false;
    const engine = ensureStockfish();
    if (!engine.isReady()) setAiStatus('loading');

    engine.init()
      .then(() => {
        if (!cancelled) setAiStatus(current => current === 'thinking' ? current : 'ready');
      })
      .catch(error => {
        if (cancelled) return;
        setAiStatus('error');
        setAiError(error instanceof Error ? error.message : 'Stockfish failed to load.');
      });

    return () => {
      cancelled = true;
    };
  }, [ensureStockfish, gameMode]);

  useEffect(() => {
    if (phase !== 'strategy') return;
    if (strategyTime <= 0) {
      setFastForwarding(false);
      setPhase('playing');
      return;
    }

    const delay = fastForwarding ? Math.round(1000 / FAST_FORWARD_RATE) : 1000;
    const timer = window.setTimeout(
      () => setStrategyTime(value => Math.max(0, value - 1)),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [fastForwarding, phase, strategyTime]);

  useEffect(() => {
    const release = () => setFastForwarding(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return;

    const timer = window.setInterval(() => {
      const pos = position.current;
      if (!pos) return;

      if (gameMode === 'ai' && pos.turn === aiColor && aiStatus === 'loading') return;

      if (pos.turn === 'white') {
        setWhiteClock(value => {
          const next = value - 1;
          if (next <= 0) {
            setEndMessage('Black wins on time');
            setPhase('ended');
            stockfish.current?.cancelSearch();
            return 0;
          }
          return next;
        });
      } else {
        setBlackClock(value => {
          const next = value - 1;
          if (next <= 0) {
            setEndMessage('White wins on time');
            setPhase('ended');
            stockfish.current?.cancelSearch();
            return 0;
          }
          return next;
        });
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [aiColor, aiStatus, gameMode, phase]);

  useEffect(() => {
    const pos = position.current;
    if (
      phase !== 'playing' ||
      gameMode !== 'ai' ||
      !aiColor ||
      !pos ||
      pos.turn !== aiColor ||
      endMessage
    ) return;

    let cancelled = false;
    const engine = ensureStockfish();
    const fenSnapshot = makeFen(pos.toSetup());

    const playAiMove = async () => {
      try {
        if (!engine.isReady()) setAiStatus('loading');
        await engine.init();
        if (cancelled) return;
        setAiStatus('thinking');

        const uci = await engine.bestMove(fenSnapshot, aiDifficulty);
        if (cancelled) return;

        const current = position.current;
        if (
          !current ||
          current.turn !== aiColor ||
          makeFen(current.toSetup()) !== fenSnapshot
        ) return;

        const move = parseUci(uci);
        if (!move || !current.isLegal(move)) {
          throw new Error(`Stockfish returned an invalid move: ${uci}`);
        }

        const orig = uci.slice(0, 2) as Key;
        const dest = uci.slice(2, 4) as Key;
        finishMove(move, orig, dest);
        setAiStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setAiStatus('error');
        setAiError(error instanceof Error ? error.message : 'Stockfish could not make a move.');
      }
    };

    void playAiMove();
    return () => {
      cancelled = true;
      engine.cancelSearch();
    };
  }, [aiColor, aiDifficulty, endMessage, ensureStockfish, fen, finishMove, gameMode, phase, turn]);

  useEffect(() => {
    if (!boardElement.current || !position.current || positionId === null) return;

    if (ground.current) {
      ground.current.destroy();
      ground.current = null;
    }

    ground.current = Chessground(boardElement.current, {
      orientation,
      coordinates: true,
      coordinatesOnSquares: true,
      blockTouchScroll: true,
      disableContextMenu: true,
      autoCastle: true,
      movable: {
        free: false,
        rookCastle: true,
        events: {
          after: (orig, dest) => moveHandler.current(orig, dest),
        },
      },
    });

    syncBoard();

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => ground.current?.redrawAll())
      : null;
    if (observer) observer.observe(boardElement.current);

    return () => {
      observer?.disconnect();
      ground.current?.destroy();
      ground.current = null;
    };
  }, [positionId]);

  useEffect(() => {
    syncBoard();
  }, [aiStatus, fen, lastMove, orientation, phase, syncBoard, turn]);

  useEffect(() => () => stockfish.current?.destroy(), []);

  const resetCurrentPosition = useCallback(() => {
    if (positionId !== null) beginPosition(positionId, humanColor);
  }, [beginPosition, humanColor, positionId]);

  const copyFen = useCallback(async () => {
    if (!fen) return;
    try {
      await navigator.clipboard.writeText(fen);
    } catch {
      // Clipboard can be unavailable in some embedded/private browser contexts.
    }
  }, [fen]);

  const playerLabel = useCallback((color: GroundColor) => {
    if (gameMode !== 'ai' || !aiColor) return color === 'white' ? 'White' : 'Black';
    return color === aiColor ? `Stockfish · ${AI_DIFFICULTIES[aiDifficulty].label}` : 'You';
  }, [aiColor, aiDifficulty, gameMode]);

  const engineStatusText = aiStatus === 'loading'
    ? 'Loading Stockfish…'
    : aiStatus === 'thinking'
      ? 'Robot is thinking…'
      : aiStatus === 'ready'
        ? 'Stockfish ready'
        : aiStatus === 'error'
          ? 'AI needs attention'
          : '';

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <div>
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">Q</div>
            <div>
              <h1>QURR CHESS</h1>
              <p>Freestyle 960 tournament board</p>
            </div>
          </div>

          <section className="position-card" aria-label="Current position">
            <span className="eyebrow">POSITION CODE</span>
            <strong>{positionId === null ? '---' : `#${positionId}`}</strong>
            {backRank && <code>{backRank}</code>}
          </section>

          {positionId !== null && (
            <section className="match-summary-card">
              <span className="eyebrow">MATCH MODE</span>
              <strong>{gameMode === 'ai' ? 'You vs Stockfish' : 'Human vs Human'}</strong>
              {gameMode === 'ai' && (
                <p>🤖 {AI_DIFFICULTIES[aiDifficulty].label} · You play {humanColor}</p>
              )}
            </section>
          )}

          {phase === 'strategy' && (
            <section className="strategy-card">
              <div className="strategy-header">
                <span>Strategy phase</span>
                <span className="live-dot">LIVE</span>
              </div>
              <strong>{formatClock(strategyTime)}</strong>
              <p>Study the unfamiliar back rank before the game clock begins.</p>
              <FastForwardButton
                active={fastForwarding}
                onStart={() => setFastForwarding(true)}
                onStop={() => setFastForwarding(false)}
                onTap={skipStrategy}
              />
              <button className="secondary-button" onClick={startGameNow}>Start clocks now</button>
            </section>
          )}

          {gameMode === 'ai' && positionId !== null && (
            <div className={`engine-status ${aiStatus}`}>
              <span className="robot-dot" aria-hidden="true">🤖</span>
              <div>
                <b>{engineStatusText}</b>
                {aiError && <small>{aiError}</small>}
              </div>
            </div>
          )}

          {positionId !== null && (
            <section className="clock-stack" aria-label="Game clocks">
              <div className={`player-clock ${turn === 'black' && phase === 'playing' ? 'active' : ''}`}>
                <div><span className="piece-token dark">♚</span><b>{playerLabel('black')}</b></div>
                <strong>{formatClock(blackClock)}</strong>
              </div>
              <div className={`player-clock ${turn === 'white' && phase === 'playing' ? 'active' : ''}`}>
                <div><span className="piece-token light">♔</span><b>{playerLabel('white')}</b></div>
                <strong>{formatClock(whiteClock)}</strong>
              </div>
            </section>
          )}

          {endMessage && <div className="result-banner">{endMessage}</div>}

          <div className="utility-grid">
            <button onClick={() => setOrientation(value => value === 'white' ? 'black' : 'white')} disabled={positionId === null}>
              Flip board
            </button>
            <button onClick={resetCurrentPosition} disabled={positionId === null}>Reset</button>
            <button onClick={copyFen} disabled={!fen}>Copy FEN</button>
          </div>
        </div>

        <div className="sidebar-bottom">
          <button className="shuffle-button" onClick={shuffleMatch}>
            <span aria-hidden="true">↻</span>
            Shuffle New Match
          </button>
          <p className="rules-note">Chess960 · legal moves by chessops · Stockfish 18 AI · touch board by Chessground</p>
        </div>
      </aside>

      <section className="board-stage">
        <header className="mobile-header">
          <div>
            <span className="eyebrow">QURR CHESS</span>
            <strong>{positionId === null ? 'Freestyle 960' : `Position #${positionId}`}</strong>
          </div>
          <button onClick={shuffleMatch}>Shuffle</button>
        </header>

        {positionId === null ? (
          <div className="setup-state">
            <div className="setup-copy">
              <div className="empty-icon" aria-hidden="true">♞</div>
              <span className="eyebrow">CHOOSE YOUR MATCH</span>
              <h2>Freestyle chess, your way.</h2>
              <p>Play locally with another person or challenge a real Stockfish-powered robot. Every match still begins from one of the 960 legal starting positions.</p>
            </div>

            <div className="mode-grid" role="radiogroup" aria-label="Game mode">
              <button
                className={`mode-card ${gameMode === 'human' ? 'selected' : ''}`}
                onClick={() => setGameMode('human')}
                role="radio"
                aria-checked={gameMode === 'human'}
              >
                <span className="mode-icon" aria-hidden="true">👥</span>
                <b>Human vs Human</b>
                <small>Two players share this board.</small>
              </button>
              <button
                className={`mode-card ${gameMode === 'ai' ? 'selected' : ''}`}
                onClick={() => setGameMode('ai')}
                role="radio"
                aria-checked={gameMode === 'ai'}
              >
                <span className="mode-icon" aria-hidden="true">🤖</span>
                <b>Play the AI</b>
                <small>Stockfish 18 runs locally in your browser.</small>
              </button>
            </div>

            {gameMode === 'ai' && (
              <div className="ai-setup-panel">
                <div className="setup-section-heading">
                  <div>
                    <span className="eyebrow">ROBOT STRENGTH</span>
                    <h3>Choose the AI</h3>
                  </div>
                  <span className={`status-pill ${aiStatus}`}>{engineStatusText || 'Preparing…'}</span>
                </div>

                <div className="difficulty-grid" role="radiogroup" aria-label="AI difficulty">
                  {(Object.keys(AI_DIFFICULTIES) as AiDifficulty[]).map(level => (
                    <button
                      key={level}
                      className={`difficulty-card ${aiDifficulty === level ? 'selected' : ''}`}
                      onClick={() => setAiDifficulty(level)}
                      role="radio"
                      aria-checked={aiDifficulty === level}
                    >
                      <b>{AI_DIFFICULTIES[level].label}</b>
                      <small>{AI_DIFFICULTIES[level].subtitle}</small>
                    </button>
                  ))}
                </div>

                <div className="side-choice-row">
                  <span>Play as</span>
                  <div role="radiogroup" aria-label="Choose your color">
                    {(['white', 'black', 'random'] as SideChoice[]).map(choice => (
                      <button
                        key={choice}
                        className={sideChoice === choice ? 'selected' : ''}
                        onClick={() => setSideChoice(choice)}
                        role="radio"
                        aria-checked={sideChoice === choice}
                      >
                        {choice === 'white' ? 'White' : choice === 'black' ? 'Black' : 'Random'}
                      </button>
                    ))}
                  </div>
                </div>

                {aiError && <p className="setup-error">{aiError}</p>}
              </div>
            )}

            <button className="shuffle-button main-cta setup-cta" onClick={shuffleMatch}>
              <span aria-hidden="true">↻</span>
              Shuffle & Start Match
            </button>
          </div>
        ) : (
          <div className="game-layout">
            <div className="board-column">
              <div className="board-frame">
                <div ref={boardElement} className="cg-wrap board-mount" aria-label="Interactive Chess960 board" />
                {phase === 'strategy' && (
                  <div className="board-overlay strategy-overlay">
                    <div>
                      <span>STRATEGY PHASE</span>
                      <strong>{formatClock(strategyTime)}</strong>
                      <small>Study the position, or speed the countdown up.</small>
                      <FastForwardButton
                        compact
                        active={fastForwarding}
                        onStart={() => setFastForwarding(true)}
                        onStop={() => setFastForwarding(false)}
                        onTap={skipStrategy}
                      />
                      <button className="overlay-start-button" onClick={startGameNow}>Start now</button>
                    </div>
                  </div>
                )}
                {phase === 'playing' && gameMode === 'ai' && aiStatus === 'thinking' && (
                  <div className="ai-thinking-chip" aria-live="polite">
                    <span aria-hidden="true">🤖</span> Stockfish thinking…
                  </div>
                )}
                {phase === 'ended' && endMessage && (
                  <div className="board-overlay ended">
                    <div>
                      <span>GAME OVER</span>
                      <strong className="end-title">{endMessage}</strong>
                      <button onClick={shuffleMatch}>New position</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mobile-clocks">
                <div className={turn === 'white' && phase === 'playing' ? 'active' : ''}>
                  <span>{playerLabel('white')}</span><strong>{formatClock(whiteClock)}</strong>
                </div>
                <div className={turn === 'black' && phase === 'playing' ? 'active' : ''}>
                  <span>{playerLabel('black')}</span><strong>{formatClock(blackClock)}</strong>
                </div>
              </div>
              {gameMode === 'ai' && (
                <div className={`mobile-engine-status ${aiStatus}`} aria-live="polite">
                  <span aria-hidden="true">🤖</span>{engineStatusText}{aiError ? ` · ${aiError}` : ''}
                </div>
              )}
            </div>

            <aside className="moves-panel">
              <div className="moves-heading">
                <div>
                  <span className="eyebrow">GAME LOG</span>
                  <h2>Move history</h2>
                </div>
                <span>{moves.length} ply</span>
              </div>
              <div className="moves-list">
                {moves.length === 0 ? (
                  <div className="moves-empty">Moves will appear here after the strategy phase.</div>
                ) : (
                  Array.from({ length: Math.ceil(moves.length / 2) }, (_, index) => (
                    <div className="move-row" key={index}>
                      <span>{index + 1}.</span>
                      <b>{moves[index * 2] ?? ''}</b>
                      <b>{moves[index * 2 + 1] ?? ''}</b>
                    </div>
                  ))
                )}
              </div>
              <div className="fen-card">
                <span className="eyebrow">LIVE FEN</span>
                <code>{fen}</code>
              </div>
            </aside>
          </div>
        )}
      </section>

      {pendingPromotion && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
          <div className="promotion-modal">
            <span className="eyebrow">PAWN PROMOTION</span>
            <h2>Choose a piece</h2>
            <div className="promotion-grid">
              <button onClick={() => choosePromotion('queen')}><span>♕</span>Queen</button>
              <button onClick={() => choosePromotion('rook')}><span>♖</span>Rook</button>
              <button onClick={() => choosePromotion('bishop')}><span>♗</span>Bishop</button>
              <button onClick={() => choosePromotion('knight')}><span>♘</span>Knight</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
