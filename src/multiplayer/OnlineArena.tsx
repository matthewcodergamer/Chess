import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import { createRoom, joinRoom, connectRoom, multiplayerConfigured } from './client';
import type { RoomSeat, RoomSnapshot, ServerEvent } from './types';

const promotionLetters = ['q', 'r', 'b', 'n'] as const;
type PromotionLetter = typeof promotionLetters[number];

type Props = {
  onClose: () => void;
};

function formatClockMs(value: number): string {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function roomPosition(snapshot: RoomSnapshot | null): Chess | null {
  if (!snapshot) return null;
  try {
    return Chess.fromSetup(parseFen(snapshot.fen).unwrap()).unwrap();
  } catch {
    return null;
  }
}

export default function OnlineArena({ onClose }: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const ground = useRef<ChessgroundApi | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});

  const queryRoom = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
  const [name, setName] = useState('Guest');
  const [roomCode, setRoomCode] = useState(queryRoom);
  const [seat, setSeat] = useState<RoomSeat | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [now, setNow] = useState(Date.now());

  const pos = useMemo(() => roomPosition(snapshot), [snapshot]);
  const yourTurn = Boolean(
    seat && snapshot && snapshot.status === 'playing' && snapshot.turn === seat.color && !snapshot.result,
  );

  const liveStrategySeconds = snapshot?.strategyEndsAt
    ? Math.max(0, Math.ceil((snapshot.strategyEndsAt - now) / 1000))
    : 0;

  const send = useCallback((payload: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(payload));
  }, []);

  const syncBoard = useCallback(() => {
    if (!ground.current || !snapshot || !pos) return;
    ground.current.set({
      fen: snapshot.fen,
      orientation: seat?.color ?? 'white',
      turnColor: snapshot.turn,
      check: snapshot.check,
      animation: { enabled: true, duration: 160 },
      draggable: { enabled: yourTurn, autoDistance: true, showGhost: true },
      selectable: { enabled: yourTurn },
      movable: {
        free: false,
        color: yourTurn ? snapshot.turn : undefined,
        dests: yourTurn ? chessgroundDests(pos, { chess960: true }) : new Map(),
        showDests: true,
        rookCastle: true,
      },
    });
  }, [pos, seat?.color, snapshot, yourTurn]);

  const handleMove = useCallback((orig: Key, dest: Key) => {
    if (!yourTurn || !pos) {
      requestAnimationFrame(syncBoard);
      return;
    }

    const from = parseSquare(orig);
    const piece = from === undefined ? undefined : pos.board.get(from);
    if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
      setPendingPromotion({ orig, dest });
      requestAnimationFrame(syncBoard);
      return;
    }

    send({ type: 'move', uci: `${orig}${dest}` });
  }, [pos, send, syncBoard, yourTurn]);

  moveHandler.current = handleMove;

  useEffect(() => {
    if (!seat) return;
    setMessage('');
    const ws = connectRoom(
      seat,
      (event: ServerEvent) => {
        if (event.type === 'snapshot') setSnapshot(event.room);
        else setMessage(event.message);
      },
      status => setConnection(status === 'closed' ? 'closed' : status),
    );
    socket.current = ws;
    return () => {
      ws.close();
      if (socket.current === ws) socket.current = null;
    };
  }, [seat]);

  useEffect(() => {
    if (!snapshot || snapshot.status !== 'strategy') return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  useEffect(() => {
    if (!boardRef.current || !snapshot) return;
    ground.current?.destroy();
    ground.current = Chessground(boardRef.current, {
      orientation: seat?.color ?? 'white',
      coordinates: true,
      coordinatesOnSquares: true,
      blockTouchScroll: true,
      disableContextMenu: true,
      autoCastle: true,
      movable: {
        free: false,
        rookCastle: true,
        events: { after: (orig, dest) => moveHandler.current(orig, dest) },
      },
    });
    syncBoard();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => ground.current?.redrawAll())
      : null;
    if (observer) observer.observe(boardRef.current);
    return () => {
      observer?.disconnect();
      ground.current?.destroy();
      ground.current = null;
    };
  }, [snapshot?.code]);

  useEffect(() => syncBoard(), [syncBoard]);

  const create = async () => {
    setBusy(true);
    setMessage('');
    try {
      const created = await createRoom(name.trim() || 'Guest');
      setRoomCode(created.code);
      setSeat(created);
      const url = new URL(window.location.href);
      url.searchParams.set('room', created.code);
      window.history.replaceState({}, '', url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create room.');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return setMessage('Enter a room code first.');
    setBusy(true);
    setMessage('');
    try {
      const joined = await joinRoom(code, name.trim() || 'Guest');
      setSeat(joined);
      const url = new URL(window.location.href);
      url.searchParams.set('room', joined.code);
      window.history.replaceState({}, '', url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not join room.');
    } finally {
      setBusy(false);
    }
  };

  const choosePromotion = (promotion: PromotionLetter) => {
    if (!pendingPromotion) return;
    const { orig, dest } = pendingPromotion;
    setPendingPromotion(null);
    send({ type: 'move', uci: `${orig}${dest}${promotion}` });
  };

  const canLeave = snapshot?.status !== 'playing';

  if (!seat) {
    return (
      <section className="online-lobby-panel" aria-label="Online multiplayer lobby">
        <div className="online-lobby-heading">
          <div>
            <span className="eyebrow">ONLINE MULTIPLAYER</span>
            <h3>Play across different internet connections</h3>
            <p>Create a private room, send the six-character code to another player, and both boards stay synchronized by the authoritative game server.</p>
          </div>
          <span className={`server-readiness ${multiplayerConfigured ? 'configured' : ''}`}>
            {multiplayerConfigured ? 'Server configured' : 'Backend connection required'}
          </span>
        </div>

        <label className="online-field">
          <span>Your display name</span>
          <input value={name} maxLength={28} onChange={event => setName(event.target.value)} placeholder="Player name" />
        </label>

        <div className="online-actions-grid">
          <button className="online-primary" onClick={create} disabled={!multiplayerConfigured || busy}>
            Create private room
          </button>
          <div className="join-room-box">
            <input
              value={roomCode}
              onChange={event => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ROOM CODE"
              inputMode="text"
              aria-label="Room code"
            />
            <button onClick={join} disabled={!multiplayerConfigured || busy}>Join</button>
          </div>
        </div>

        {!multiplayerConfigured && (
          <p className="backend-note">The browser UI and multiplayer server are included in the repository, but the server must be deployed to a real-time host before players on different networks can connect.</p>
        )}
        {message && <p className="online-error">{message}</p>}
        <button className="online-back" onClick={onClose}>Back to match choices</button>
      </section>
    );
  }

  return (
    <section className="online-room-shell">
      <header className="online-room-header">
        <div>
          <span className="eyebrow">LIVE ROOM</span>
          <strong>{seat.code}</strong>
          <small>{connection === 'connected' ? '● Connected' : `● ${connection}`}</small>
        </div>
        {canLeave ? <button onClick={onClose}>Leave room</button> : <span className="game-locked-pill">Game locked in progress</span>}
      </header>

      {snapshot ? (
        <div className="online-game-grid">
          <div className="online-board-column">
            <div className="board-frame online-board-frame">
              <div ref={boardRef} className="cg-wrap board-mount" aria-label="Online Chess960 board" />
              {snapshot.status === 'waiting' && (
                <div className="board-overlay online-waiting-overlay">
                  <div><span>WAITING FOR OPPONENT</span><strong className="room-code-display">{snapshot.code}</strong><small>Share this room code with the second player.</small></div>
                </div>
              )}
              {snapshot.status === 'strategy' && (
                <div className="board-overlay strategy-overlay online-strategy-overlay">
                  <div>
                    <span>STRATEGY PHASE</span>
                    <strong>{formatClockMs(liveStrategySeconds * 1000)}</strong>
                    <small>Both players see the same server-controlled countdown.</small>
                    <button className="overlay-start-button" onClick={() => send({ type: 'start_now' })}>Start Now</button>
                  </div>
                </div>
              )}
              {snapshot.check && !snapshot.checkmate && <div className="check-watermark">CHECK</div>}
              {snapshot.checkmate && <div className="checkmate-watermark">CHECKMATE</div>}
              {snapshot.status === 'ended' && snapshot.result && (
                <div className="board-overlay ended online-ended-overlay">
                  <div><span>GAME OVER</span><strong className="end-title">{snapshot.result}</strong></div>
                </div>
              )}
            </div>

            <div className="online-clock-row">
              <div className={snapshot.turn === 'white' && snapshot.status === 'playing' ? 'active' : ''}>
                <span>White · {snapshot.players.white?.name ?? 'Waiting'}</span><strong>{formatClockMs(snapshot.whiteClockMs)}</strong>
              </div>
              <div className={snapshot.turn === 'black' && snapshot.status === 'playing' ? 'active' : ''}>
                <span>Black · {snapshot.players.black?.name ?? 'Waiting'}</span><strong>{formatClockMs(snapshot.blackClockMs)}</strong>
              </div>
            </div>
            {snapshot.status !== 'playing' && seat.color === 'white' && (
              <button className="choose-pattern-button" onClick={() => send({ type: 'choose_pattern' })}>Choose Pattern</button>
            )}
            {snapshot.status === 'playing' && <div className="online-turn-note">{yourTurn ? 'Your move' : 'Opponent’s move'}</div>}
            {message && <p className="online-error">{message}</p>}
          </div>

          <aside className="online-room-side">
            <span className="eyebrow">ROOM DETAILS</span>
            <h3>Position #{snapshot.positionId}</h3>
            <div className="seat-list">
              <div><span className="seat-dot white" />White <b>{snapshot.players.white?.name ?? 'Open seat'}</b></div>
              <div><span className="seat-dot black" />Black <b>{snapshot.players.black?.name ?? 'Open seat'}</b></div>
            </div>
            <div className="move-count-card"><span>Moves</span><strong>{snapshot.moves.length}</strong></div>
            <p className="server-authority-note">Moves, clocks, position state and game results are validated by the room server—not trusted from either browser.</p>
          </aside>
        </div>
      ) : (
        <div className="online-connecting-state">Connecting to room {seat.code}…</div>
      )}

      {pendingPromotion && (
        <div className="online-promotion" role="dialog" aria-label="Choose online promotion piece">
          <div>
            <b>Promote pawn</b>
            <button onClick={() => choosePromotion('q')}>♕ Queen</button>
            <button onClick={() => choosePromotion('r')}>♖ Rook</button>
            <button onClick={() => choosePromotion('b')}>♗ Bishop</button>
            <button onClick={() => choosePromotion('n')}>♘ Knight</button>
          </div>
        </div>
      )}
    </section>
  );
}
