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

const STRATEGY_SECONDS = 120;
const GAME_SECONDS = 10 * 60;

type Phase = 'idle' | 'strategy' | 'playing' | 'ended';
type PromotionRole = Extract<Role, 'queen' | 'rook' | 'bishop' | 'knight'>;

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

export default function App() {
  const boardElement = useRef<HTMLDivElement | null>(null);
  const ground = useRef<ChessgroundApi | null>(null);
  const position = useRef<Chess | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});

  const [positionId, setPositionId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [strategyTime, setStrategyTime] = useState(STRATEGY_SECONDS);
  const [orientation, setOrientation] = useState<GroundColor>('white');
  const [fen, setFen] = useState('');
  const [turn, setTurn] = useState<GroundColor>('white');
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [moves, setMoves] = useState<string[]>([]);
  const [whiteClock, setWhiteClock] = useState(GAME_SECONDS);
  const [blackClock, setBlackClock] = useState(GAME_SECONDS);
  const [endMessage, setEndMessage] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion>(null);

  const backRank = useMemo(
    () => (positionId === null ? null : chess960BackRank(positionId)),
    [positionId],
  );

  const syncBoard = useCallback(() => {
    const pos = position.current;
    const api = ground.current;
    if (!pos || !api) return;

    api.set({
      fen: makeFen(pos.toSetup()),
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      lastMove,
      viewOnly: phase === 'idle',
      animation: { enabled: true, duration: 170 },
      draggable: {
        enabled: phase === 'playing',
        showGhost: true,
        autoDistance: true,
      },
      selectable: { enabled: phase === 'playing' },
      movable: {
        free: false,
        color: phase === 'playing' ? pos.turn : undefined,
        dests: phase === 'playing' ? chessgroundDests(pos, { chess960: true }) : new Map(),
        showDests: true,
        rookCastle: true,
      },
    });
  }, [lastMove, orientation, phase]);

  const beginPosition = useCallback((id: number) => {
    const setup = parseFen(chess960Fen(id)).unwrap();
    const nextPosition = Chess.fromSetup(setup).unwrap();

    position.current = nextPosition;
    setPositionId(id);
    setFen(makeFen(nextPosition.toSetup()));
    setTurn('white');
    setPhase('strategy');
    setStrategyTime(STRATEGY_SECONDS);
    setMoves([]);
    setLastMove(undefined);
    setWhiteClock(GAME_SECONDS);
    setBlackClock(GAME_SECONDS);
    setEndMessage(null);
    setPendingPromotion(null);
    setOrientation('white');
  }, []);

  const shuffleMatch = useCallback(() => beginPosition(randomChess960Id()), [beginPosition]);

  const startGameNow = useCallback(() => {
    if (position.current && phase === 'strategy') {
      setStrategyTime(0);
      setPhase('playing');
    }
  }, [phase]);

  const finishMove = useCallback((move: Move, orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || phase !== 'playing' || !pos.isLegal(move)) {
      requestAnimationFrame(syncBoard);
      return;
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
    }
  }, [phase, syncBoard]);

  const handleBoardMove = useCallback((orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || phase !== 'playing') {
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
  }, [finishMove, phase, syncBoard]);

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
    if (phase !== 'strategy') return;
    if (strategyTime <= 0) {
      setPhase('playing');
      return;
    }

    const timer = window.setTimeout(() => setStrategyTime(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, strategyTime]);

  useEffect(() => {
    if (phase !== 'playing') return;

    const timer = window.setInterval(() => {
      const pos = position.current;
      if (!pos) return;

      if (pos.turn === 'white') {
        setWhiteClock(value => {
          const next = value - 1;
          if (next <= 0) {
            setEndMessage('Black wins on time');
            setPhase('ended');
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
            return 0;
          }
          return next;
        });
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase]);

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

    return () => {
      ground.current?.destroy();
      ground.current = null;
    };
  }, [positionId]);

  useEffect(() => {
    syncBoard();
  }, [fen, orientation, phase, lastMove, syncBoard]);

  const resetCurrentPosition = useCallback(() => {
    if (positionId !== null) beginPosition(positionId);
  }, [beginPosition, positionId]);

  const copyFen = useCallback(async () => {
    if (!fen) return;
    try {
      await navigator.clipboard.writeText(fen);
    } catch {
      // Clipboard can be unavailable in some embedded/private browser contexts.
    }
  }, [fen]);

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

          {phase === 'strategy' && (
            <section className="strategy-card">
              <div className="strategy-header">
                <span>Strategy phase</span>
                <span className="live-dot">LIVE</span>
              </div>
              <strong>{formatClock(strategyTime)}</strong>
              <p>Study the unfamiliar back rank before the game clock begins.</p>
              <button className="secondary-button" onClick={startGameNow}>Start clocks now</button>
            </section>
          )}

          {positionId !== null && (
            <section className="clock-stack" aria-label="Game clocks">
              <div className={`player-clock ${turn === 'black' && phase === 'playing' ? 'active' : ''}`}>
                <div><span className="piece-token dark">♚</span><b>Black</b></div>
                <strong>{formatClock(blackClock)}</strong>
              </div>
              <div className={`player-clock ${turn === 'white' && phase === 'playing' ? 'active' : ''}`}>
                <div><span className="piece-token light">♔</span><b>White</b></div>
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
          <p className="rules-note">Chess960 · legal moves by chessops · touch board by Chessground</p>
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
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">♞</div>
            <h2>Every game starts differently.</h2>
            <p>Generate one of all 960 legal starting formations. The bishops stay on opposite colors and the king always begins between both rooks.</p>
            <button className="shuffle-button main-cta" onClick={shuffleMatch}>Shuffle First Match</button>
          </div>
        ) : (
          <div className="game-layout">
            <div className="board-column">
              <div className="board-frame">
                <div ref={boardElement} className="cg-wrap board-mount" aria-label="Interactive Chess960 board" />
                {phase === 'strategy' && (
                  <div className="board-overlay">
                    <div>
                      <span>STRATEGY PHASE</span>
                      <strong>{formatClock(strategyTime)}</strong>
                      <small>Board unlocks when the countdown ends</small>
                    </div>
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
                <div className={turn === 'white' && phase === 'playing' ? 'active' : ''}><span>White</span><strong>{formatClock(whiteClock)}</strong></div>
                <div className={turn === 'black' && phase === 'playing' ? 'active' : ''}><span>Black</span><strong>{formatClock(blackClock)}</strong></div>
              </div>
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
