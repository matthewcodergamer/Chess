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

type ClockParts = {
  label: string;
  minutes: string | null;
  seconds: string | null;
  lowTime: boolean;
};

function clockParts(value: string): ClockParts {
  const normalized = value.trim();
  const match = /^(\d+):([0-5]\d)$/.exec(normalized);
  if (!match) return { label: normalized, minutes: null, seconds: null, lowTime: false };
  const numericMinutes = Number(match[1]);
  const numericSeconds = Number(match[2]);
  const minutes = String(numericMinutes).padStart(2, '0');
  return {
    label: `${minutes}:${match[2]}`,
    minutes,
    seconds: match[2],
    lowTime: numericMinutes * 60 + numericSeconds <= 30,
  };
}

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
  const clock = clockParts(time);
  return (
    <div
      className={`match-player-bar ${active ? 'active' : ''} ${self ? 'self' : 'opponent'}`}
      aria-label={`${name}, ${colorLabel}, ${clock.label} remaining, ${connection}${active ? ', turn to move' : ''}`}
    >
      <span className={`match-player-dot ${color} ${connected ? 'connected' : 'offline'}`} aria-hidden="true" />
      <div className="match-player-main">
        <div className="match-player-identity">
          <b>{name}</b>
          <span>{rating}</span>
          {active && <span className="match-turn-indicator"><span aria-hidden="true">▶</span> Turn</span>}
          <small className={connected ? 'connected' : 'offline'}>{connection}</small>
        </div>
        <ReconnectCountdown active={reconnectingOpponent} />
        <CapturedPieces fen={fen} forColor={color} compact />
      </div>
      <strong
        className={`match-player-time ${clock.lowTime ? 'low-time' : ''}`.trim()}
        aria-label={`${clock.label} remaining`}
      >
        {clock.minutes && clock.seconds ? (
          <>
            <span className="match-clock-minutes">{clock.minutes}</span>
            <span className="match-clock-colon" aria-hidden="true">:</span>
            <span className="match-clock-seconds">{clock.seconds}</span>
          </>
        ) : clock.label}
      </strong>
      <span className="qqurz-sr-only" aria-live="polite" aria-atomic="true">{active ? `${name}, ${colorLabel} to move.` : reconnectingOpponent ? `${name} disconnected and is reconnecting.` : ''}</span>
    </div>
  );
}
