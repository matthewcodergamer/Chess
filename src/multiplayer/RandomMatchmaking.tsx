import { useEffect, useRef, useState } from 'react';
import { TIME_CONTROL_PRESETS, type TimeControl } from '../../shared/timeControl';
import TimeControlPicker from '../ui/TimeControlPicker';
import { IconButton, PrimaryButton, SecondaryButton } from '../ui/controls';
import {
  cancelMatch,
  enqueueMatch,
  getPresenceId,
  loadMatch,
  multiplayerConfigured,
  type MatchmakingCriteria,
  type MatchmakingSnapshot,
  type RegionPreference,
} from './client';
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

function regionLabel(value: RegionPreference): string {
  if (value === 'nearest') return 'Nearest';
  if (value === 'global') return 'Worldwide';
  return 'Regional';
}

export default function RandomMatchmaking({ onlinePlayers, onOnlinePlayers, onMatched, onBack }: Props) {
  const [name, setName] = useState(profileName);
  const [ticket, setTicket] = useState('');
  const [opponent, setOpponent] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<MatchmakingSnapshot | null>(null);
  const [ratingRange, setRatingRange] = useState(200);
  const [timeControl, setTimeControl] = useState<TimeControl>(() => ({ ...TIME_CONTROL_PRESETS['10+5'] }));
  const [regionPreference, setRegionPreference] = useState<RegionPreference>('regional');
  const [maxLatencyMs, setMaxLatencyMs] = useState(140);
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
    setBusy(true);
    setMessage('');
    setLatest(null);
    setOpponent(null);
    const criteria: MatchmakingCriteria = {
      variant: 'chess960',
      ratingRange,
      timeControl,
      regionPreference,
      maxLatencyMs,
    };
    try {
      const match = await enqueueMatch(name.trim() || 'Guest', presenceId, criteria);
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
    setLatest(null);
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
        finishMatch(match);
      } catch (error) {
        if (stopped) return;
        waitingRef.current = false;
        setTicket('');
        setLatest(null);
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

  const activeRange = latest?.search.ratingRange ?? ratingRange;
  const waitedSeconds = Math.floor((latest?.search.waitedMs ?? 0) / 1000);

  return (
    <section className="qqurz-matchmaking-page" aria-label="Find a public Chess960 opponent">
      <div className="matchmaking-card">
        <IconButton onClick={onBack} aria-label="Back to home">←</IconButton>
        <div className="matchmaking-presence"><span className="presence-dot" /> <b>{onlinePlayers ?? '—'}</b> players online</div>
        <span className="matchmaking-eyebrow">PUBLIC MATCHMAKING</span>
        <h1>Find the right game.</h1>
        <p>Choose the match you want. QQURZ checks your rating on the server, chooses the opponent, and creates the game room.</p>

        <label className="matchmaking-name">
          <span>Playing as</span>
          <input value={name} maxLength={28} onChange={event => setName(event.target.value)} placeholder="Guest" disabled={Boolean(ticket)} />
        </label>

        <fieldset className="matchmaking-filters" disabled={Boolean(ticket)}>
          <div className="matchmaking-filter-grid">
            <div className="matchmaking-filter matchmaking-variant">
              <span>Variant</span>
              <b>Chess960</b>
              <small>Current competitive pool</small>
            </div>
            <label className="matchmaking-filter">
              <span>Starting rating range</span>
              <select value={ratingRange} onChange={event => setRatingRange(Number(event.target.value))}>
                <option value={100}>±100</option>
                <option value={200}>±200</option>
                <option value={350}>±350</option>
                <option value={500}>±500</option>
              </select>
              <small>Widens automatically while you wait</small>
            </label>
            <label className="matchmaking-filter">
              <span>Region</span>
              <select value={regionPreference} onChange={event => setRegionPreference(event.target.value as RegionPreference)}>
                <option value="nearest">Nearest</option>
                <option value="regional">Regional</option>
                <option value="global">Worldwide</option>
              </select>
              <small>{regionLabel(regionPreference)} search preference</small>
            </label>
            <label className="matchmaking-filter">
              <span>Latency budget</span>
              <select value={maxLatencyMs} onChange={event => setMaxLatencyMs(Number(event.target.value))}>
                <option value={80}>Up to ~80 ms</option>
                <option value={140}>Up to ~140 ms</option>
                <option value={220}>Up to ~220 ms</option>
                <option value={300}>Up to ~300 ms</option>
              </select>
              <small>Server-estimated route constraint</small>
            </label>
          </div>
          <TimeControlPicker value={timeControl} onChange={setTimeControl} allowCustom={false} label="Time control" />
        </fieldset>

        {!ticket ? (
          <PrimaryButton fullWidth size="lg" leadingIcon="♞" onClick={start} disabled={!multiplayerConfigured} loading={busy} loadingLabel="Joining queue">
            Find an opponent
          </PrimaryButton>
        ) : (
          <div className="matchmaking-searching" role="status" aria-live="polite">
            <span className="matchmaking-spinner" aria-hidden="true" />
            <div>
              <b>Looking for a player…</b>
              <small>±{activeRange} rating · {timeControl.label} · {regionLabel(regionPreference)}{waitedSeconds ? ` · ${waitedSeconds}s` : ''}</small>
            </div>
            <SecondaryButton size="sm" onClick={cancel}>Cancel</SecondaryButton>
          </div>
        )}

        {latest && (
          <div className="matchmaking-search-meta" aria-label="Server matchmaking status">
            <span><small>Your server rating</small><b>{Math.round(latest.rating)}{latest.provisional ? '?' : ''}</b></span>
            <span><small>Current range</small><b>±{latest.search.ratingRange}</b></span>
            <span><small>Latency</small><b>{latest.search.estimatedLatencyMs === null ? 'Checking' : `~${latest.search.estimatedLatencyMs} ms`}</b></span>
          </div>
        )}

        {opponent && <p className="matchmaking-found">Matched with {opponent}{latest?.opponentRating ? ` · ${Math.round(latest.opponentRating)}` : ''}.</p>}
        {message && <p className="matchmaking-error">{message}</p>}
        {!multiplayerConfigured && <p className="matchmaking-error">The realtime server is not configured in this build.</p>}

        <div className="matchmaking-rules">
          <span><i>960</i><b>Variant + time matched</b></span>
          <span><i>↗</i><b>Rating range expands</b></span>
          <span><i>✓</i><b>Server picks & records</b></span>
        </div>
      </div>
    </section>
  );
}
