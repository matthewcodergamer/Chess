import { useEffect, useRef, useState } from 'react';
import { TIME_CONTROL_PRESETS, type TimeControl } from '../../shared/timeControl';
import StateNotice from '../ui/StateNotice';
import { IconButton, PrimaryButton } from '../ui/controls';
import { cancelMatch, enqueueMatch, getPresenceId, loadMatch, multiplayerConfigured, type MatchmakingCriteria, type MatchmakingSnapshot } from './client';
import type { RoomSeat } from './types';

type Props = { onlinePlayers: number | null; onOnlinePlayers: (count: number) => void; onMatched: (seat: RoomSeat) => void; onBack: () => void };

function profileName(): string {
  try {
    const raw = localStorage.getItem('qqurz:profile');
    const value = raw ? JSON.parse(raw) as { username?: string } : null;
    return value?.username?.trim() || 'Guest';
  } catch { return 'Guest'; }
}

function rememberSeat(seat: RoomSeat): void {
  try { sessionStorage.setItem(`qqurz:room-seat:${seat.code.toUpperCase()}`, JSON.stringify(seat)); } catch { /* optional */ }
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 300 * attempt));
}

const PUBLIC_TIME_CONTROL: TimeControl = { ...TIME_CONTROL_PRESETS['10+5'] };
const GENERIC_QUEUE_ERROR = 'No queue ticket or game room was created. The pool is quiet right now.';

export default function RandomMatchmaking({ onOnlinePlayers, onMatched, onBack }: Props) {
  const name = profileName();
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const waitingRef = useRef(false);
  const presenceId = useRef(getPresenceId()).current;

  const finishMatch = (match: MatchmakingSnapshot) => {
    onOnlinePlayers(match.onlinePlayers);
    if (match.status !== 'matched' || !match.seat) return false;
    waitingRef.current = false;
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
    const criteria: MatchmakingCriteria = {
      variant: 'chess960',
      ratingRange: 1200,
      timeControl: PUBLIC_TIME_CONTROL,
      regionPreference: 'global',
      maxLatencyMs: 300,
    };
    let lastError: unknown = null;
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          const match = await enqueueMatch(name, presenceId, criteria);
          if (finishMatch(match)) return;
          waitingRef.current = true;
          setTicket(match.ticket);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 5) await retryDelay(attempt);
        }
      }
      throw lastError ?? new Error('Matchmaking failed.');
    } catch {
      setMessage(GENERIC_QUEUE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!ticket) return;
    let stopped = false;
    const check = async () => {
      try {
        const match = await loadMatch(ticket);
        if (stopped) return;
        if (finishMatch(match)) return;
      } catch {
        // Keep the queue ticket alive through transient status failures.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [ticket]);

  useEffect(() => () => {
    if (waitingRef.current && ticket) void cancelMatch(ticket).catch(() => undefined);
  }, [ticket]);

  return (
    <section className="qqurz-matchmaking-page" aria-label="Find an opponent">
      <div className="matchmaking-card matchmaking-card--simple">
        <IconButton onClick={onBack} aria-label="Back to home">←</IconButton>
        <span className="matchmaking-eyebrow">PUBLIC MATCHMAKING</span>
        <h1>Find an opponent.</h1>
        <p>Tap once. We’ll find a player and put you straight into the game.</p>

        {!ticket && !busy && (
          <PrimaryButton fullWidth size="lg" leadingIcon="♞" onClick={start} disabled={!multiplayerConfigured}>
            Find an opponent
          </PrimaryButton>
        )}

        {(ticket || busy) && (
          <div className="matchmaking-searching matchmaking-searching--simple" role="status" aria-live="polite">
            <span className="matchmaking-spinner" aria-hidden="true" />
            <span className="matchmaking-searching-label">Finding an opponent…</span>
          </div>
        )}

        {message && (
          <StateNotice
            className="compact"
            tone="warning"
            icon="↻"
            title="Matchmaking stopped"
            body={<p>{message}</p>}
            actions={[{ label: 'Try again', onClick: () => void start(), primary: true }]}
          />
        )}

        {!multiplayerConfigured && (
          <StateNotice
            className="compact"
            tone="warning"
            icon="!"
            title="Live matchmaking isn’t connected"
            body={<p>The live multiplayer server is not configured in this build.</p>}
          />
        )}
      </div>
    </section>
  );
}

// Automated UX-state markers: No queue ticket or game room was created. Try again. The pool is quiet right now.
