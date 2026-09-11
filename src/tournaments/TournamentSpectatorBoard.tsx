import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChessBoardSurface, { type QQurzChessgroundApi, type QQurzChessgroundConfig } from '../ui/ChessBoardSurface';
import MatchPlayerBar from '../ui/MatchPlayerBar';
import { connectSpectatorRoom } from '../multiplayer/spectatorClient';
import type { RoomConnectionStatus } from '../multiplayer/client';
import type { RoomSnapshot, ServerEvent } from '../multiplayer/types';
import { authoritativeRoomSession } from '../multiplayer/session';
import { clockOwner, isTerminalGameState } from '../../shared/gameSession';
import { motionTokenMs, useReducedMotion } from '../ui/motion';

type Props = {
  roomCode: string;
};

function formatClockMs(value: number): string {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function connectionLabel(status: RoomConnectionStatus): string {
  if (status === 'connected') return 'Live';
  if (status === 'reconnecting') return 'Reconnecting…';
  if (status === 'connecting') return 'Connecting…';
  return 'Feed unavailable';
}

export default function TournamentSpectatorBoard({ roomCode }: Props) {
  const ground = useRef<QQurzChessgroundApi | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotAt, setSnapshotAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [connection, setConnection] = useState<RoomConnectionStatus>('connecting');
  const [message, setMessage] = useState('');
  const reducedMotion = useReducedMotion();
  const pieceMotionMs = reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 160);

  const session = useMemo(() => snapshot ? authoritativeRoomSession(snapshot) : null, [snapshot]);
  const activeColor = session ? clockOwner(session) : null;
  const elapsed = snapshot ? Math.max(0, now - snapshotAt) : 0;
  const whiteMs = session ? Math.max(0, session.clocks.whiteMs - (activeColor === 'white' ? elapsed : 0)) : 0;
  const blackMs = session ? Math.max(0, session.clocks.blackMs - (activeColor === 'black' ? elapsed : 0)) : 0;

  useEffect(() => {
    setSnapshot(null);
    setMessage('');
    const connectionHandle = connectSpectatorRoom(roomCode, (event: ServerEvent) => {
      if (event.type === 'error') {
        setMessage(event.message);
        return;
      }
      if (event.type !== 'snapshot') return;
      const receivedAt = Date.now();
      setSnapshot(event.room);
      setSnapshotAt(receivedAt);
      setNow(receivedAt);
      setMessage('');
    }, setConnection);
    return () => connectionHandle.close();
  }, [roomCode]);

  useEffect(() => {
    if (!session || isTerminalGameState(session.state)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [session?.state]);

  const syncBoard = useCallback(() => {
    if (!ground.current || !session) return;
    ground.current.set({
      fen: session.fen,
      orientation: 'white',
      turnColor: session.sideToMove,
      check: session.check,
      animation: { enabled: !reducedMotion, duration: pieceMotionMs },
      draggable: { enabled: false },
      selectable: { enabled: false },
      movable: { free: false, color: undefined, dests: new Map(), showDests: false, rookCastle: true },
    });
  }, [pieceMotionMs, reducedMotion, session]);

  useEffect(() => syncBoard(), [syncBoard]);

  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: session?.fen,
    orientation: 'white',
    turnColor: session?.sideToMove ?? 'white',
    coordinates: true,
    coordinatesOnSquares: true,
    blockTouchScroll: true,
    disableContextMenu: true,
    autoCastle: true,
    movable: { free: false, rookCastle: true },
  }), [roomCode, session?.fen, session?.sideToMove]);

  if (!snapshot || !session) {
    return (
      <div className="spectator-board-loading" role="status">
        <span className={`spectator-live-dot ${connection}`} aria-hidden="true" />
        <b>{connectionLabel(connection)}</b>
        <small>Room {roomCode}</small>
        {message && <p>{message}</p>}
      </div>
    );
  }

  const white = snapshot.players.white;
  const black = snapshot.players.black;
  return (
    <section className="spectator-board-shell" aria-label={`Spectating room ${roomCode}`}>
      <div className="spectator-board-main">
        <div className="spectator-board-meta">
          <div><span className={`spectator-live-dot ${connection}`} aria-hidden="true" /><b>{connectionLabel(connection)}</b></div>
          <span>Room {roomCode} · {session.connection.status.toLowerCase()}</span>
        </div>

        <MatchPlayerBar
          color="black"
          name={black?.name ?? 'Waiting for player'}
          rating={black?.rating ?? 'Unrated'}
          connection={black?.connected ? 'Connected' : 'Disconnected'}
          connected={Boolean(black?.connected)}
          time={formatClockMs(blackMs)}
          fen={session.fen}
          active={activeColor === 'black'}
        />

        <div className="board-frame match-board-frame spectator-board-frame">
          <ChessBoardSurface
            apiRef={ground}
            instanceKey={`spectator-${roomCode}`}
            config={boardConfig}
            ariaLabel="Read-only tournament spectator board"
            onReady={syncBoard}
          />
          {isTerminalGameState(session.state) && session.result && (
            <div className="board-overlay ended online-ended-overlay">
              <div><span>FINAL</span><strong className="end-title">{session.result}</strong></div>
            </div>
          )}
        </div>

        <MatchPlayerBar
          color="white"
          name={white?.name ?? 'White'}
          rating={white?.rating ?? 'Unrated'}
          connection={white?.connected ? 'Connected' : 'Disconnected'}
          connected={Boolean(white?.connected)}
          time={formatClockMs(whiteMs)}
          fen={session.fen}
          active={activeColor === 'white'}
        />
      </div>

      <aside className="spectator-board-side">
        <div className="spectator-readonly-note">
          <span>READ ONLY</span>
          <b>Live competitive feed</b>
          <p>Board, clocks and results come from the authoritative room. Analysis is intentionally separate from active player interfaces.</p>
        </div>
        <div className="spectator-result-card">
          <span>Result</span>
          <b>{session.result ?? 'Game in progress'}</b>
          <small>{session.checkmate ? 'Checkmate' : session.check ? 'Check' : session.sideToMove === 'white' ? 'White to move' : 'Black to move'}</small>
        </div>
        <div className="spectator-moves">
          <div><span>MOVES</span><b>{session.moveNumber}</b></div>
          {session.movesSan.length ? (
            <ol>
              {session.movesSan.map((move, index) => <li key={`${index}-${move}`}><span>{index + 1}</span><b>{move}</b></li>)}
            </ol>
          ) : <p>No moves yet.</p>}
        </div>
        {message && <p className="spectator-feed-error" role="status">{message}</p>}
      </aside>
    </section>
  );
}
