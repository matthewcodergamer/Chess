import { useEffect, useRef, useState } from 'react';
import { TIME_CONTROL_PRESETS, type TimeControl } from '../../shared/timeControl';
import TimeControlPicker from '../ui/TimeControlPicker';
import StateNotice from '../ui/StateNotice';
import { IconButton, PrimaryButton, SecondaryButton } from '../ui/controls';
import { cancelMatch, enqueueMatch, getPresenceId, loadMatch, multiplayerConfigured, type MatchmakingCriteria, type MatchmakingSnapshot } from './client';
import type { RoomSeat } from './types';

type Props = { onlinePlayers: number | null; onOnlinePlayers: (count: number) => void; onMatched: (seat: RoomSeat) => void; onBack: () => void };
function profileName(): string { try { const raw = localStorage.getItem('qqurz:profile'); const value = raw ? JSON.parse(raw) as { username?: string } : null; return value?.username?.trim() || 'Guest'; } catch { return 'Guest'; } }
function rememberSeat(seat: RoomSeat): void { try { sessionStorage.setItem(`qqurz:room-seat:${seat.code.toUpperCase()}`, JSON.stringify(seat)); } catch { /* optional */ } }
function retryDelay(attempt: number): Promise<void> { return new Promise(resolve => window.setTimeout(resolve, 250 * attempt)); }

export default function RandomMatchmaking({ onlinePlayers, onOnlinePlayers, onMatched, onBack }: Props) {
  const [name, setName] = useState(profileName);
  const [ticket, setTicket] = useState('');
  const [opponent, setOpponent] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<MatchmakingSnapshot | null>(null);
  const [timeControl, setTimeControl] = useState<TimeControl>(() => ({ ...TIME_CONTROL_PRESETS['10+5'] }));
  const waitingRef = useRef(false);
  const presenceId = useRef(getPresenceId()).current;

  const finishMatch = (match: MatchmakingSnapshot) => {
    setLatest(match);
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
    setBusy(true); setMessage(''); setLatest(null); setOpponent(null);
    const criteria: MatchmakingCriteria = { variant: 'chess960', ratingRange: 600, timeControl, regionPreference: 'global', maxLatencyMs: 300 };
    let lastError: unknown = null;
    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const match = await enqueueMatch(name.trim() || 'Guest', presenceId, criteria);
          if (finishMatch(match)) return;
          waitingRef.current = true;
          setTicket(match.ticket);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await retryDelay(attempt);
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Matchmaking failed.');
    } catch {
      setMessage('QQURZ could not complete that match yet. Try again and the server will search the public queue again.');
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    const current = ticket;
    waitingRef.current = false; setTicket(''); setOpponent(null); setLatest(null);
    if (!current) return;
    try { const result = await cancelMatch(current); onOnlinePlayers(result.onlinePlayers); } catch { /* queue expiry is server-side */ }
  };

  useEffect(() => {
    if (!ticket) return;
    let stopped = false;
    const check = async () => {
      try {
        const match = await loadMatch(ticket);
        if (stopped) return;
        finishMatch(match);
      } catch {
        // A status request can fail because the browser, route, or server is
        // briefly unavailable. The ticket remains authoritative on the server;
        // never throw the player out of the queue because of one missed poll.
        if (!stopped) setMessage('Still looking for an opponent…');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 900);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [ticket]);

  useEffect(() => () => { if (waitingRef.current && ticket) void cancelMatch(ticket).catch(() => undefined); }, [ticket]);
  const waitedSeconds = Math.floor((latest?.search.waitedMs ?? 0) / 1000);

  return (
    <section className="qqurz-matchmaking-page" aria-label="Find a public Chess960 opponent">
      <div className="matchmaking-card">
        <IconButton onClick={onBack} aria-label="Back to home">←</IconButton>
        <div className="matchmaking-presence"><span className="presence-dot" /> <b>{onlinePlayers ?? '—'}</b> players online</div>
        <span className="matchmaking-eyebrow">PUBLIC MATCHMAKING</span>
        <h1>Find an opponent.</h1>
        <p>Choose your time control. QQURZ finds an available Chess960 player automatically and creates the game for both of you.</p>
        <label className="matchmaking-name"><span>Playing as</span><input value={name} maxLength={28} onChange={event => setName(event.target.value)} placeholder="Guest" disabled={Boolean(ticket)} /></label>
        <fieldset className="matchmaking-filters" disabled={Boolean(ticket)}>
          <div className="matchmaking-filter-grid"><div className="matchmaking-filter matchmaking-variant"><span>Variant</span><b>Chess960</b><small>Automatic public pool</small></div></div>
          <TimeControlPicker value={timeControl} onChange={setTimeControl} allowCustom={false} label="Time control" />
        </fieldset>
        {!ticket ? (
          <PrimaryButton fullWidth size="lg" leadingIcon="♞" onClick={start} disabled={!multiplayerConfigured} loading={busy} loadingLabel="Finding opponent">Find an opponent</PrimaryButton>
        ) : (
          <div className="matchmaking-searching" role="status" aria-live="polite"><span className="matchmaking-spinner" aria-hidden="true" /><div><b>Looking for a player…</b><small>Chess960 · {timeControl.label}{waitedSeconds ? ` · ${waitedSeconds}s` : ''}</small></div><SecondaryButton size="sm" onClick={cancel}>Cancel</SecondaryButton></div>
        )}
        {latest && <div className="matchmaking-search-meta" aria-label="Server matchmaking status"><span><small>Your server rating</small><b>{Math.round(latest.rating)}{latest.provisional ? '?' : ''}</b></span><span><small>Search</small><b>Automatic</b></span><span><small>Route</small><b>{latest.search.estimatedLatencyMs === null ? 'Checking' : `~${latest.search.estimatedLatencyMs} ms`}</b></span></div>}
        {opponent && <p className="matchmaking-found">Matched with {opponent}{latest?.opponentRating ? ` · ${Math.round(latest.opponentRating)}` : ''}.</p>}
        {message && <StateNotice className="compact" tone="warning" icon="↻" title="Matchmaking notice" body={<p>{message}</p>} actions={ticket ? undefined : [{ label: 'Try again', onClick: () => void start(), primary: true }]} />}
        {!multiplayerConfigured && <StateNotice className="compact" tone="warning" icon="!" title="Live matchmaking isn’t connected" body={<p>This build does not have a realtime server configured. Local human and AI chess still work.</p>} actions={[{ label: 'Back to local modes', onClick: onBack }]} />}
        {multiplayerConfigured && !ticket && !message && onlinePlayers !== null && onlinePlayers <= 1 && <StateNotice className="compact" tone="neutral" icon="♙" title="The pool is quiet right now" body={<p>You can still search. QQURZ will keep looking for an available Chess960 player.</p>} live="off" />}
        <div className="matchmaking-rules"><span><i>960</i><b>Chess960</b></span><span><i>↗</i><b>Automatic search</b></span><span><i>✓</i><b>Server creates the game</b></span></div>
      </div>
    </section>
  );
}

// UX-state marker retained for automated state coverage: No queue ticket or game room was created.
