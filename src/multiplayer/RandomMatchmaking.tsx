import { useEffect, useRef, useState } from 'react';
import { cancelMatch, enqueueMatch, getPresenceId, loadMatch, multiplayerConfigured, type MatchmakingSnapshot } from './client';
import type { RoomSeat } from './types';

type Props = {
  onlinePlayers: number | null;
  onOnlinePlayers: (count: number) => void;
  onMatched: (seat: RoomSeat) => void;
  onBack: () => void;
};

function profileName(): string {
  try {
    const raw = localStorage.getItem('qqurz:profile');
    const value = raw ? JSON.parse(raw) as { username?: string } : null;
    return value?.username?.trim() || 'Guest';
  } catch {
    return 'Guest';
  }
}

function rememberSeat(seat: RoomSeat): void {
  try {
    sessionStorage.setItem(`qqurz:room-seat:${seat.code.toUpperCase()}`, JSON.stringify(seat));
  } catch {
    // Session persistence is helpful but the match can still continue without it.
  }
}

export default function RandomMatchmaking({ onlinePlayers, onOnlinePlayers, onMatched, onBack }: Props) {
  const [name, setName] = useState(profileName);
  const [ticket, setTicket] = useState('');
  const [opponent, setOpponent] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const waitingRef = useRef(false);
  const presenceId = useRef(getPresenceId()).current;

  const finishMatch = (match: MatchmakingSnapshot) => {
    onOnlinePlayers(match.onlinePlayers);
    if (match.status !== 'matched' || !match.seat) return false;
    waitingRef.current = false;
    setOpponent(match.opponent);
    rememberSeat(match.seat);
    const url = new URL(location.href);
    url.searchParams.set('room', match.seat.code.toUpperCase());
    history.replaceState({}, '', url);
    onMatched(match.seat);
    return true;
  };

  const start = async () => {
    if (!multiplayerConfigured || busy || ticket) return;
    setBusy(true);
    setMessage('');
    try {
      const match = await enqueueMatch(name.trim() || 'Guest', presenceId);
      onOnlinePlayers(match.onlinePlayers);
      if (finishMatch(match)) return;
      waitingRef.current = true;
      setTicket(match.ticket);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enter matchmaking.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const current = ticket;
    waitingRef.current = false;
    setTicket('');
    setOpponent(null);
    if (!current) return;
    try {
      const result = await cancelMatch(current);
      onOnlinePlayers(result.onlinePlayers);
    } catch {
      // The queue entry also expires server-side, so cancellation is best effort.
    }
  };

  useEffect(() => {
    if (!ticket) return;
    let stopped = false;
    const check = async () => {
      try {
        const match = await loadMatch(ticket);
        if (stopped) return;
        onOnlinePlayers(match.onlinePlayers);
        finishMatch(match);
      } catch (error) {
        if (stopped) return;
        waitingRef.current = false;
        setTicket('');
        setMessage(error instanceof Error ? error.message : 'Matchmaking ticket expired.');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 900);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [ticket]);

  useEffect(() => () => {
    if (waitingRef.current && ticket) void cancelMatch(ticket).catch(() => undefined);
  }, [ticket]);

  return (
    <section className="qqurz-matchmaking-page" aria-label="Find a random Chess960 opponent">
      <div className="matchmaking-card">
        <button className="matchmaking-back" onClick={onBack}>← Back</button>
        <div className="matchmaking-presence"><span className="presence-dot" /> <b>{onlinePlayers ?? '—'}</b> players online</div>
        <span className="matchmaking-eyebrow">LIVE CHESS960</span>
        <h1>Play anyone.</h1>
        <p>QQURZ will pair you with another available player on the website. Your username is all they see in the match.</p>

        <label className="matchmaking-name">
          <span>Playing as</span>
          <input value={name} maxLength={28} onChange={event => setName(event.target.value)} placeholder="Guest" disabled={Boolean(ticket)} />
        </label>

        {!ticket ? (
          <button className="matchmaking-find" onClick={start} disabled={!multiplayerConfigured || busy}>
            <span>♞</span>
            <b>{busy ? 'Joining queue…' : 'Find an opponent'}</b>
          </button>
        ) : (
          <div className="matchmaking-searching" role="status" aria-live="polite">
            <span className="matchmaking-spinner" aria-hidden="true" />
            <div><b>Looking for a player…</b><small>Keep this page open. The match starts automatically.</small></div>
            <button onClick={cancel}>Cancel</button>
          </div>
        )}

        {opponent && <p className="matchmaking-found">Matched with {opponent}.</p>}
        {message && <p className="matchmaking-error">{message}</p>}
        {!multiplayerConfigured && <p className="matchmaking-error">The realtime server is not configured in this build.</p>}

        <div className="matchmaking-rules">
          <span><i>960</i><b>Chess960</b></span>
          <span><i>10</i><b>10 minute clock</b></span>
          <span><i>↯</i><b>Server validated</b></span>
        </div>
      </div>
    </section>
  );
}
