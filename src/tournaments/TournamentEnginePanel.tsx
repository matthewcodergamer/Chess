import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountToken } from '../account/client';
import TournamentLivePanel from './TournamentLivePanel';
import {
  advanceEngineTournament,
  cancelEngineTournament,
  checkInEngineTournament,
  createEngineTournament,
  listEngineTournaments,
  loadEngineTournament,
  loadEngineTournamentMe,
  registerEngineTournament,
  startEngineTournament,
  type EngineTieBreak,
  type EngineTournamentDefinition,
  type EngineTournamentDetail,
  type EngineTournamentFormat,
  type EngineTournamentMe,
  type EngineTournamentSummary,
} from './engineClient';

type Props = { onOpenGame: () => void };

const TIE_BREAKS: Array<[EngineTieBreak, string]> = [
  ['direct_encounter', 'Direct encounter'],
  ['buchholz', 'Buchholz'],
  ['sonneborn_berger', 'Sonneborn–Berger'],
  ['wins', 'Wins'],
  ['rating', 'Rating'],
  ['seed', 'Seed'],
];

function localDateTime(ms: number): string {
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function formatName(value: EngineTournamentFormat): string {
  if (value === 'swiss') return 'Swiss';
  if (value === 'round_robin') return 'Round robin';
  return 'Single elimination';
}
function statusLabel(value: EngineTournamentSummary['status']): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
function roundDefault(format: EngineTournamentFormat, capacity: number): number {
  if (format === 'single_elimination') return Math.max(1, Math.ceil(Math.log2(Math.max(2, capacity))));
  if (format === 'round_robin') return capacity % 2 === 0 ? capacity - 1 : capacity;
  return Math.max(3, Math.ceil(Math.log2(Math.max(4, capacity))) + 1);
}
function payoutSplit(detail: EngineTournamentDetail): string {
  if (detail.payout.mode !== 'percent') return detail.payout.mode === 'none' ? 'None' : `${money(detail.payout.poolCents)} fixed pool`;
  const places = detail.payout.places.filter(rule => rule.value > 0).map(rule => `${rule.place === 1 ? '1st' : rule.place === 2 ? '2nd' : `${rule.place}th`} ${rule.value / 100}%`);
  return places.join(' · ') || 'None';
}

export default function TournamentEnginePanel({ onOpenGame }: Props) {
  const [events, setEvents] = useState<EngineTournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<EngineTournamentDetail | null>(null);
  const [me, setMe] = useState<EngineTournamentMe | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [title, setTitle] = useState('Friday Chess960 Open');
  const [format, setFormat] = useState<EngineTournamentFormat>('swiss');
  const [capacity, setCapacity] = useState(32);
  const [startTime, setStartTime] = useState(() => localDateTime(Date.now() + 60 * 60_000));
  const [entryMode, setEntryMode] = useState<'open' | 'invite'>('open');
  const [entryFee, setEntryFee] = useState(0);
  const [createInviteCode, setCreateInviteCode] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [minRating, setMinRating] = useState('');
  const [maxRating, setMaxRating] = useState('');
  const [registrationCloseMinutes, setRegistrationCloseMinutes] = useState(0);
  const [checkInRequired, setCheckInRequired] = useState(true);
  const [checkInOpenMinutes, setCheckInOpenMinutes] = useState(30);
  const [checkInGraceMinutes, setCheckInGraceMinutes] = useState(5);
  const [baseMinutes, setBaseMinutes] = useState(10);
  const [incrementSeconds, setIncrementSeconds] = useState(5);
  const [positionMode, setPositionMode] = useState<'per_game' | 'per_round' | 'fixed'>('per_round');
  const [positionId, setPositionId] = useState(518);
  const [roundCount, setRoundCount] = useState(6);
  const [tieBreaks, setTieBreaks] = useState<EngineTieBreak[]>(['buchholz', 'sonneborn_berger', 'wins', 'rating', 'seed']);
  const [payoutMode, setPayoutMode] = useState<'none' | 'percent' | 'fixed'>('none');
  const [payoutPool, setPayoutPool] = useState(0);
  const [firstPayout, setFirstPayout] = useState(70);
  const [secondPayout, setSecondPayout] = useState(30);
  const [thirdPayout, setThirdPayout] = useState(0);

  const signedIn = Boolean(accountToken());
  const fundedEvent = entryFee > 0;
  const fundedPayoutTotal = firstPayout + secondPayout + thirdPayout;
  const estimatedFundedPoolCents = Math.floor(capacity * Math.round(entryFee * 100) * 0.8);
  const fundedDefinitionValid = !fundedEvent || (payoutMode === 'percent' && fundedPayoutTotal === 100 && capacity <= 128);

  const refreshList = useCallback(async () => {
    try {
      const value = await listEngineTournaments();
      setEvents(value.tournaments);
      setSelectedId(current => current || value.tournaments[0]?.id || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load tournament engine.');
    }
  }, []);

  const refreshSelected = useCallback(async () => {
    if (!selectedId) { setDetail(null); setMe(null); return; }
    try {
      const next = await loadEngineTournament(selectedId);
      setDetail(next);
      if (signedIn) {
        try { setMe(await loadEngineTournamentMe(selectedId)); }
        catch { setMe(null); }
      } else setMe(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load tournament.');
    }
  }, [selectedId, signedIn]);

  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => {
    void refreshSelected();
    if (!selectedId) return;
    const timer = window.setInterval(() => { void refreshSelected(); void refreshList(); }, 3500);
    return () => window.clearInterval(timer);
  }, [refreshList, refreshSelected, selectedId]);

  useEffect(() => {
    if (format === 'round_robin' && capacity < 3) { setCapacity(3); return; }
    if (format === 'round_robin' && capacity > 16) { setCapacity(16); return; }
    if (fundedEvent && capacity > 128) { setCapacity(128); return; }
    setRoundCount(roundDefault(format, capacity));
  }, [format, capacity, fundedEvent]);

  useEffect(() => {
    if (fundedEvent && payoutMode !== 'percent') setPayoutMode('percent');
  }, [fundedEvent, payoutMode]);

  const createDefinition = (): EngineTournamentDefinition => {
    const effectivePayoutMode = fundedEvent ? 'percent' : payoutMode;
    const payoutPlaces = effectivePayoutMode === 'none' ? [] : [
      { place: 1, value: Math.round(firstPayout * 100) },
      { place: 2, value: Math.round(secondPayout * 100) },
      { place: 3, value: Math.round(thirdPayout * 100) },
    ].filter(rule => rule.value > 0);
    return {
      title,
      format,
      capacity,
      startTime: new Date(startTime).getTime(),
      entryRules: {
        mode: entryMode,
        inviteCode: entryMode === 'invite' ? createInviteCode : undefined,
        requiresVerifiedAccount: verifiedOnly,
        minRating: minRating ? Number(minRating) : null,
        maxRating: maxRating ? Number(maxRating) : null,
        registrationClosesBeforeStartMs: registrationCloseMinutes * 60_000,
        entryFeeCents: fundedEvent ? Math.round(entryFee * 100) : 0,
      },
      checkInRules: { required: checkInRequired, opensBeforeStartMs: checkInOpenMinutes * 60_000, closesAfterStartMs: checkInGraceMinutes * 60_000 },
      timeControl: { baseMs: Math.round(baseMinutes * 60_000), incrementMs: Math.round(incrementSeconds * 1_000) },
      positionPolicy: positionMode === 'fixed' ? { mode: 'fixed', positionId } : { mode: positionMode },
      payout: {
        mode: effectivePayoutMode,
        currency: 'USD',
        poolCents: fundedEvent ? estimatedFundedPoolCents : Math.round(payoutPool * 100),
        places: payoutPlaces,
      },
      roundCount,
      tieBreakRules: tieBreaks,
    };
  };

  const createTournament = async () => {
    if (!fundedDefinitionValid) {
      setMessage('Paid tournament prize percentages must total exactly 100%, and paid events currently support up to 128 entrants.');
      return;
    }
    setBusy('create'); setMessage('');
    try {
      const tournament = await createEngineTournament(createDefinition());
      setCreateOpen(false); setSelectedId(tournament.id); setDetail(tournament);
      await refreshList();
      setMessage(fundedEvent ? 'Funded tournament created. Entry funds will be held by the server ledger when players register.' : 'Tournament created. Registration is live.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create tournament.'); }
    finally { setBusy(''); }
  };

  const runAction = async (name: string, action: () => Promise<EngineTournamentDetail>) => {
    setBusy(name); setMessage('');
    try { setDetail(await action()); await refreshList(); await refreshSelected(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Tournament action failed.'); }
    finally { setBusy(''); }
  };

  const register = () => runAction('register', () => registerEngineTournament(selectedId, inviteCode));
  const checkIn = () => runAction('checkin', () => checkInEngineTournament(selectedId));
  const start = () => runAction('start', () => startEngineTournament(selectedId));
  const advance = () => runAction('advance', () => advanceEngineTournament(selectedId));
  const cancel = () => runAction('cancel', () => cancelEngineTournament(selectedId));

  const openGame = () => {
    const seat = me?.seat;
    if (!seat) return;
    try { sessionStorage.setItem(`qqurz:room-seat:${seat.code.toUpperCase()}`, JSON.stringify(seat)); } catch { /* optional */ }
    const url = new URL(window.location.href);
    url.searchParams.set('room', seat.code.toUpperCase());
    window.history.replaceState({}, '', url);
    onOpenGame();
  };

  const selectedRound = useMemo(() => detail?.rounds.find(round => round.number === detail.currentRound) ?? detail?.rounds.at(-1) ?? null, [detail]);
  const canRegister = Boolean(detail && ['registration', 'check_in'].includes(detail.status) && !me?.participant);
  const canCheckIn = Boolean(detail?.checkInRules.required && me?.participant && !me.participant.checkedInAt && ['registration', 'check_in'].includes(detail.status));

  return (
    <div className="engine-tournament-shell">
      <div className="engine-tournament-head">
        <div><span className="qqurz-kicker">TOURNAMENT ENGINE</span><h2>Run real Chess960 events</h2><p>Registration, check-in, funding holds, seeding, pairings, authoritative rooms, verified results and round advancement all run on the server.</p></div>
        <button className="primary-black" onClick={() => setCreateOpen(value => !value)} disabled={!signedIn}>{createOpen ? 'Close creator' : 'Create tournament'}</button>
      </div>

      {!signedIn && <div className="engine-notice">Sign in to create, register for, or check into tournaments. Live boards and standings remain public.</div>}

      {createOpen && (
        <section className="engine-create-panel" aria-label="Create tournament">
          <div className="engine-form-grid">
            <label><span>Title</span><input value={title} maxLength={100} onChange={event => setTitle(event.target.value)} /></label>
            <label><span>Format</span><select value={format} onChange={event => setFormat(event.target.value as EngineTournamentFormat)}><option value="single_elimination">Single elimination</option><option value="swiss">Swiss · FIDE Dutch</option><option value="round_robin">Round robin · Berger</option></select></label>
            <label><span>Capacity</span><input type="number" min={format === 'round_robin' ? 3 : 2} max={format === 'round_robin' ? 16 : fundedEvent ? 128 : 4096} value={capacity} onChange={event => setCapacity(Math.max(format === 'round_robin' ? 3 : 2, Number(event.target.value) || (format === 'round_robin' ? 3 : 2)))} /></label>
            <label><span>Start time</span><input type="datetime-local" value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
            <label><span>Entry fee (USD)</span><input type="number" min="0" max="1000" step="1" value={entryFee} onChange={event => setEntryFee(Math.max(0, Math.min(1000, Number(event.target.value) || 0)))} /><small>{fundedEvent ? 'Held from each approved player wallet' : '0 = free event'}</small></label>
            <label><span>Base minutes</span><input type="number" min="0.25" max="180" step="0.25" value={baseMinutes} onChange={event => setBaseMinutes(Number(event.target.value) || 10)} /></label>
            <label><span>Increment seconds</span><input type="number" min="0" max="60" value={incrementSeconds} onChange={event => setIncrementSeconds(Number(event.target.value) || 0)} /></label>
            <label><span>Chess960 positions</span><select value={positionMode} onChange={event => setPositionMode(event.target.value as typeof positionMode)}><option value="per_game">New position each game</option><option value="per_round">One position per round</option><option value="fixed">Fixed position</option></select></label>
            {positionMode === 'fixed' && <label><span>Position #</span><input type="number" min="0" max="959" value={positionId} onChange={event => setPositionId(Math.max(0, Math.min(959, Number(event.target.value) || 0)))} /></label>}
            <label><span>Rounds</span><input type="number" min="1" max="24" value={roundCount} disabled={format !== 'swiss'} onChange={event => setRoundCount(Math.max(1, Math.min(24, Number(event.target.value) || 1)))} /></label>
            <label><span>Entry access</span><select value={entryMode} onChange={event => setEntryMode(event.target.value as 'open' | 'invite')}><option value="open">Open registration</option><option value="invite">Invite code</option></select></label>
            {entryMode === 'invite' && <label><span>Invite code</span><input value={createInviteCode} minLength={4} onChange={event => setCreateInviteCode(event.target.value)} /></label>}
            <label><span>Min rating</span><input type="number" placeholder="No minimum" value={minRating} onChange={event => setMinRating(event.target.value)} /></label>
            <label><span>Max rating</span><input type="number" placeholder="No maximum" value={maxRating} onChange={event => setMaxRating(event.target.value)} /></label>
            <label><span>Registration closes before start</span><input type="number" min="0" value={registrationCloseMinutes} onChange={event => setRegistrationCloseMinutes(Math.max(0, Number(event.target.value) || 0))} /><small>minutes</small></label>
            <label><span>Check-in opens before start</span><input type="number" min="5" value={checkInOpenMinutes} onChange={event => setCheckInOpenMinutes(Math.max(5, Number(event.target.value) || 5))} /><small>minutes</small></label>
            <label><span>Check-in grace after start</span><input type="number" min="0" value={checkInGraceMinutes} onChange={event => setCheckInGraceMinutes(Math.max(0, Number(event.target.value) || 0))} /><small>minutes</small></label>
          </div>
          <div className="engine-rule-toggles"><label><input type="checkbox" checked={verifiedOnly} onChange={event => setVerifiedOnly(event.target.checked)} /> Verified accounts only</label><label><input type="checkbox" checked={checkInRequired} onChange={event => setCheckInRequired(event.target.checked)} /> Require check-in</label></div>
          <div className="engine-tiebreaks"><span>Tie-break order</span>{TIE_BREAKS.map(([value, label]) => <label key={value}><input type="checkbox" checked={tieBreaks.includes(value)} onChange={event => setTieBreaks(current => event.target.checked ? [...current, value] : current.filter(item => item !== value))} />{label}</label>)}</div>
          <div className="engine-payout-row">
            <label><span>Payout definition</span><select value={fundedEvent ? 'percent' : payoutMode} disabled={fundedEvent} onChange={event => setPayoutMode(event.target.value as typeof payoutMode)}><option value="none">No payout</option><option value="percent">Percentage split</option><option value="fixed">Fixed amounts</option></select></label>
            {fundedEvent ? <label><span>Estimated full prize pool</span><input value={money(estimatedFundedPoolCents)} readOnly /><small>80% of full-capacity entries; actual pool uses funded entries</small></label> : payoutMode !== 'none' && <label><span>Pool (USD)</span><input type="number" min="0" value={payoutPool} onChange={event => setPayoutPool(Math.max(0, Number(event.target.value) || 0))} /></label>}
            {(fundedEvent || payoutMode !== 'none') && <><label><span>1st {fundedEvent || payoutMode === 'percent' ? '%' : '$'}</span><input type="number" min="0" max={fundedEvent || payoutMode === 'percent' ? 100 : undefined} value={firstPayout} onChange={event => setFirstPayout(Math.max(0, Number(event.target.value) || 0))} /></label><label><span>2nd {fundedEvent || payoutMode === 'percent' ? '%' : '$'}</span><input type="number" min="0" max={fundedEvent || payoutMode === 'percent' ? 100 : undefined} value={secondPayout} onChange={event => setSecondPayout(Math.max(0, Number(event.target.value) || 0))} /></label><label><span>3rd {fundedEvent || payoutMode === 'percent' ? '%' : '$'}</span><input type="number" min="0" max={fundedEvent || payoutMode === 'percent' ? 100 : undefined} value={thirdPayout} onChange={event => setThirdPayout(Math.max(0, Number(event.target.value) || 0))} /></label></>}
          </div>
          <small className="engine-payout-note">{fundedEvent ? `Funded event: QQURZ books a 20% platform fee from the actual funded pot, then distributes the remaining 80% by this payout split. Current split: ${fundedPayoutTotal}%. Real-money registration remains unavailable unless the player's jurisdiction, age/KYC, tax status and payment-provider policy are approved.` : 'Free events can define test/fixed prize information separately. Competition money never comes from browser-calculated balances.'}</small>
          <button className="primary-black engine-create-submit" onClick={createTournament} disabled={busy === 'create' || !fundedDefinitionValid}>{busy === 'create' ? 'Creating…' : fundedEvent ? 'Create funded tournament' : 'Create & open registration'}</button>
        </section>
      )}

      <div className="engine-event-layout">
        <aside className="engine-event-list" aria-label="Engine tournaments">
          {events.length ? events.map(event => <button key={event.id} className={selectedId === event.id ? 'selected' : ''} onClick={() => setSelectedId(event.id)}><span>{statusLabel(event.status)} · {formatName(event.format)}</span><b>{event.title}</b><small>{event.entryFeeCents ? `${money(event.entryFeeCents)} entry · ` : 'Free · '}{event.registered}/{event.capacity} registered · {event.currentRound ? `Round ${event.currentRound}/${event.roundCount}` : `${event.roundCount} rounds`}</small></button>) : <div className="engine-empty"><b>No engine tournaments yet.</b><span>Create the first event above.</span></div>}
        </aside>

        <section className="engine-event-detail">
          {detail ? <>
            <header><div><span className={`engine-status ${detail.status}`}>{statusLabel(detail.status)}</span><h3>{detail.title}</h3><p>{formatName(detail.format)} · {detail.timeControl.label} · {detail.capacity} seats · {detail.roundCount} rounds · {detail.entryFeeCents ? `${money(detail.entryFeeCents)} entry` : 'free entry'}</p></div><div className="engine-event-actions">{canRegister && <button onClick={register} disabled={Boolean(busy)}>{busy === 'register' ? 'Funding entry…' : detail.entryFeeCents ? `Fund & register · ${money(detail.entryFeeCents)}` : 'Register'}</button>}{detail.entryRules.mode === 'invite' && canRegister && <input aria-label="Tournament invite code" placeholder="Invite code" value={inviteCode} onChange={event => setInviteCode(event.target.value)} />}{canCheckIn && <button onClick={checkIn} disabled={Boolean(busy)}>{busy === 'checkin' ? 'Checking in…' : 'Check in'}</button>}{me?.seat && <button className="primary-black" onClick={openGame}>Open assigned game</button>}</div></header>

            <div className="engine-meta-grid"><div><span>Start</span><b>{new Date(detail.startTime).toLocaleString()}</b></div><div><span>Check-in</span><b>{detail.checkInRules.required ? `${detail.checkedIn}/${detail.registered}` : 'Not required'}</b></div><div><span>Entry</span><b>{detail.entryFeeCents ? money(detail.entryFeeCents) : 'Free'}</b></div><div><span>Chess960</span><b>{detail.positionPolicy.mode === 'fixed' ? `Fixed #${detail.positionPolicy.positionId}` : detail.positionPolicy.mode === 'per_round' ? 'New each round' : 'New each game'}</b></div><div><span>Organizer</span><b>{detail.organizerName}</b></div><div><span>Tie-breaks</span><b>{detail.tieBreakRules.join(' → ').replaceAll('_', ' ')}</b></div><div><span>Payout</span><b>{detail.entryFeeCents ? `${payoutSplit(detail)} after 20% platform fee · ${detail.moneyStatus?.replaceAll('_', ' ') ?? 'registration'}` : detail.payout.mode === 'none' ? 'None' : `${money(detail.payout.poolCents)} · ${detail.payoutStatus.replaceAll('_', ' ')}`}</b></div></div>

            {detail.moneySettlementError && <div className="engine-notice">Payment settlement requires review: {detail.moneySettlementError}</div>}
            {me?.participant && <div className="engine-my-status"><b>Your entry</b><span>Rating {me.participant.rating} · seed {me.participant.seed ?? 'pending'} · {me.participant.checkedInAt ? 'checked in' : detail.checkInRules.required ? 'check-in pending' : 'registered'}{detail.entryFeeCents ? ` · ${money(detail.entryFeeCents)} held in wallet` : ''}</span>{me.pairing && <span>{me.pairing.black ? `${me.pairing.white?.name} vs ${me.pairing.black.name}` : 'Pairing bye'} · {me.pairing.status}</span>}</div>}

            {selectedRound && <section className="engine-round"><div className="engine-section-head"><div><span>PAIRINGS</span><b>Round {selectedRound.number}</b></div><small>{selectedRound.status}</small></div><div className="engine-pairings">{selectedRound.pairings.map(pairing => <div key={pairing.id} className={pairing.status}><span>Board {pairing.board}</span><b>{pairing.white?.name ?? '—'} <i>vs</i> {pairing.black?.name ?? 'BYE'}</b><small>{pairing.status === 'live' ? `Live · room ${pairing.roomCode}` : pairing.result ?? pairing.status.replaceAll('_', ' ')}{pairing.positionId >= 0 ? ` · #${pairing.positionId}` : ''}</small></div>)}</div></section>}

            <section className="engine-standings"><div className="engine-section-head"><div><span>STANDINGS</span><b>Official server table</b></div><small>{detail.standings.length} players</small></div><div className="engine-table-scroll"><table><thead><tr><th>#</th><th>Player</th><th>Rating</th><th>Pts</th><th>W</th><th>D</th><th>L</th><th>Buchholz</th><th>SB</th></tr></thead><tbody>{detail.standings.map(row => <tr key={row.participantId}><td>{row.rank}</td><td><b>{row.name}</b></td><td>{row.rating}</td><td><b>{row.score}</b></td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.buchholz.toFixed(1)}</td><td>{row.sonnebornBerger.toFixed(1)}</td></tr>)}</tbody></table></div></section>

            <details className="engine-organizer-controls"><summary>Organizer controls</summary><p>The server checks organizer ownership. Manual advance is only accepted when every game in the current round has an authoritative verified result.</p><div><button onClick={start} disabled={Boolean(busy) || !['registration', 'check_in'].includes(detail.status)}>Start now</button><button onClick={advance} disabled={Boolean(busy) || detail.status !== 'between_rounds'}>Advance round</button><button onClick={cancel} disabled={Boolean(busy) || detail.status === 'completed' || detail.status === 'cancelled'}>Cancel event</button></div></details>

            <TournamentLivePanel tournamentId={detail.id} tournamentName={detail.title} />
          </> : <div className="engine-empty"><b>Select a tournament.</b><span>Pairings, standings and assigned games will appear here.</span></div>}
        </section>
      </div>
      {message && <div className="inline-message-v14 engine-message" role="status">{message}</div>}
    </div>
  );
}
