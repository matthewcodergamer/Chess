import type { Color } from '@lichess-org/chessground/types';
import CapturedPieces from './CapturedPieces';

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
        </div>
        <CapturedPieces fen={fen} forColor={color} compact />
      </div>
      <strong className="match-player-time">{time}</strong>
      <span className="qqurz-sr-only" aria-live="polite" aria-atomic="true">{active ? `${name}, ${colorLabel} to move.` : ''}</span>
    </div>
  );
}
