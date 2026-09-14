import type { Color } from '@lichess-org/chessground/types';
import CapturedPieces from './CapturedPieces';
import ReconnectCountdown from './ReconnectCountdown';

type Props = {
  color: Color;
  name: string;
  rating?: string | number;
  connection: string;
  connected?: boolean;
  time: string;
  fen: string;
  active?: boolean;
  self?: boolean;
};

export default function MatchPlayerBar({
  color,
  name,
  rating = 'Unrated',
  connection,
  connected = true,
  time,
  fen,
  active = false,
  self = false,
}: Props) {
  const colorLabel = color === 'white' ? 'White' : 'Black';
  const reconnectingOpponent = !self && !connected && /reconnect/i.test(connection);
  return (
    <div
      className={`match-player-bar ${active ? 'active' : ''} ${self ? 'self' : 'opponent'}`}
      aria-label={`${name}, ${colorLabel}, ${time} remaining, ${connection}${active ? ', turn to move' : ''}`}
    >
      <span className={`match-player-dot ${color} ${connected ? 'connected' : 'offline'}`} aria-hidden="true" />
      <div className="match-player-main">
        <div className="match-player-identity">
          <b>{name}</b>
          <span>{rating}</span>
          {active && <span className="match-turn-indicator"><span aria-hidden="true">▶</span> Turn</span>}
          <small className={connected ? 'connected' : 'offline'}>{connection}</small>
          <ReconnectCountdown active={reconnectingOpponent} />
        </div>
        <CapturedPieces fen={fen} forColor={color} compact />
      </div>
      <strong className="match-player-time">{time}</strong>
      <span className="qqurz-sr-only" aria-live="polite" aria-atomic="true">{active ? `${name}, ${colorLabel} to move.` : reconnectingOpponent ? `${name} disconnected and is reconnecting.` : ''}</span>
    </div>
  );
}
