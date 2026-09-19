import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TIME_CONTROL_PRESETS, type TimeControl } from '../../shared/timeControl';
import { IconButton, PrimaryButton } from '../ui/controls';
import { cancelMatch, enqueueMatch, getPresenceId, loadMatch, type MatchmakingCriteria, type MatchmakingSnapshot } from './client';
import type { RoomSeat } from './types';
import { consumeHumanMatch, hasFreestyle, humanMatchBlockReason, humanMatchesRemaining } from '../premium/entitlements';

type Props = { onlinePlayers: number | null; onOnlinePlayers: (count: number) => void; onMatched: (seat: RoomSeat) => void; onBack: () => void; onShop?: () => void };

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
  return new Promise(resolve => window.setTimeout(resolve, 250 * attempt));
}

const PUBLIC_TIME_CONTROL: TimeControl = { ...TIME_CONTROL_PRESETS['10+5'] };
const GENERIC_QUEUE_ERROR = 'Could not join the matchmaking queue. Try again.';

function MatchIcon({ kind }: { kind: 'back' | 'knight' }): ReactNode {
  if (kind === 'back') return <svg className="matchmaking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
  return <svg className="matchmaking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M7 20h11M8 20c.5-3 1.7-4.8 3.8-6.2 1.7-1 2.7-2.1 2.7-4.2 0-1.8-.9-3.2-2.5-4.1.1 1.3-.5 2.2-1.8 2.6-1.2.4-2.4.1-3.2-.8.1 2.1.9 3.5 2.4 4.4-2.2 1.3-3.4 3.6-3.4 6.3M15 5.7c1.8.3 3 1.5 3.3 3.4" /></svg>;
}

export default function RandomMatchmaking({ onOnlinePlayers, onMatched, onBack, onShop }: Props) {
  const name = profileName();
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
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
    if (busy || ticket) return;
    const blocked = humanMatchBlockReason();
    if (blocked) return;
    setBusy(true);
    setFailed(false);
    const criteria: MatchmakingCriteria = {
      variant: 'chess960',
      ratingRange: 600,
      timeControl: PUBLIC_TIME_CONTROL,
      regionPreference: 'global',
      maxLatencyMs: 300,
    };
    let lastError: unknown = null;
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          const match = await enqueueMatch(name, presenceId, criteria);
          consumeHumanMatch();
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
      // Keep infrastructure details out of the product surface; the next search remains available.
      setFailed(true);
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
        // Keep the ticket alive through transient status failures.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 350);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [ticket]);

  useEffect(() => () => {
    if (waitingRef.current && ticket) void cancelMatch(ticket).catch(() => undefined);
  }, [ticket]);

  const searching = busy || Boolean(ticket);

  return (
    <section className="qqurz-matchmaking-page" aria-label="Find an opponent">
      <div className="matchmaking-card matchmaking-card--simple">
        <div className="matchmaking-simple-top">
          <IconButton onClick={onBack} aria-label="Back to home"><MatchIcon kind="back" /></IconButton>
          <span className="matchmaking-time-pill">Chess960 · 10+5</span>
        </div>

        <div className="matchmaking-simple-copy">
          <span className="eyebrow">QUICK MATCH</span>
          <h1>Find an opponent.</h1>
          <p>Join the live Chess960 queue. We’ll keep you waiting here until you’re matched or you leave.{hasFreestyle() ? '' : ` ${humanMatchesRemaining()} casual human matches left this month.`}</p>
        </div>

        {humanMatchBlockReason() && (
          <p className="human-match-note">{humanMatchBlockReason()} {onShop ? <button type="button" onClick={onShop}>See plans</button> : null}</p>
        )}

        {!searching && !failed && (
          <PrimaryButton className="matchmaking-simple-cta" fullWidth size="lg" leadingIcon={<MatchIcon kind="knight" />} onClick={start} disabled={Boolean(humanMatchBlockReason())}>
            Find an opponent
          </PrimaryButton>
        )}

        {searching && (
          <div className="matchmaking-searching matchmaking-searching--simple" role="status" aria-live="polite">
            <span className="matchmaking-spinner" aria-hidden="true" />
            <div><b>Looking for an opponent…</b><small>Stay here — matchmaking is still active.</small></div>
          </div>
        )}

        {failed && !searching && (
          <div className="matchmaking-retry" role="alert">
            <span>{GENERIC_QUEUE_ERROR}</span>
            <PrimaryButton size="sm" onClick={() => void start()}>Try again</PrimaryButton>
          </div>
        )}

      </div>
    </section>
  );
}

// Automated UX-state markers: No queue ticket or game room was created. The pool is quiet right now.
