import { useEffect, useMemo, useState } from 'react';
import { multiplayerConfigured } from '../multiplayer/client';
import { celebratePurchase } from '../ui/purchaseCelebration';
import {
  createCheckout,
  FALLBACK_TOURNAMENTS,
  loadTournamentCatalog,
  registerTournament,
  verifyCheckout,
  type Tournament,
  type TournamentCatalog,
} from './client';
import {
  ANNUAL_CHAMPIONSHIP_ENTRY_CENTS,
  ANNUAL_CHAMPIONSHIP_SEATS,
  PLATFORM_RAKE_BPS,
  TOURNAMENT_ENTRY_CENTS,
  TOURNAMENT_SEEDS,
  bracketRounds,
  disconnectAllowanceSeconds,
  earlyMoveLimitSeconds,
  firstMoveAllowanceSeconds,
  isAnnualChampionship,
  isTournamentCombinationAvailable,
  roundLabel,
  tournamentId,
  type TournamentSelection,
} from './model';

type Props = {
  onBack: () => void;
  onPlayOnline: () => void;
  onShow3D: () => void;
};

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

function shortMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 2)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}K`;
  return `$${dollars}`;
}

function profileName(): string {
  try {
    const raw = localStorage.getItem('qqurz:profile');
    const value = raw ? JSON.parse(raw) as { username?: string } : null;
    return value?.username?.trim() || 'Guest';
  } catch { return 'Guest'; }
}

function asSelection(event: Tournament): TournamentSelection {
  return {
    id: event.id,
    name: event.name,
    seats: event.seats,
    entryCents: event.entryCents,
    registeredSeats: event.registeredSeats,
    status: event.status,
    timeControl: event.timeControl,
    baseMinutes: event.baseMinutes,
    incrementSeconds: event.incrementSeconds,
    format: event.format,
    platformRakeBps: event.platformRakeBps,
    grossCents: event.grossCents,
    platformFeeCents: event.platformFeeCents,
    prizePoolCents: event.prizePoolCents,
    paidPlaces: event.paidPlaces,
    annualOnly: event.annualOnly,
  };
}

function BracketPreview({ seats }: { seats: number }) {
  const rounds = bracketRounds(seats);
  return (
    <div className="master-bracket-scroll" aria-label={`${seats}-seed single-elimination bracket`}>
      <div className="master-bracket" style={{ '--bracket-rounds': rounds } as React.CSSProperties}>
        {Array.from({ length: rounds }, (_, index) => {
          const players = seats / (2 ** index);
          const matches = players / 2;
          const visibleMatches = Math.min(matches, index === 0 ? 8 : 6);
          return (
            <section className="bracket-round" key={index}>
              <header><span>{roundLabel(index, rounds)}</span><b>{matches.toLocaleString()} {matches === 1 ? 'match' : 'matches'}</b></header>
              <div className="bracket-nodes">
                {Array.from({ length: visibleMatches }, (_, match) => (
                  <div className="bracket-match" key={match}>
                    <span><i>{index === 0 ? match * 2 + 1 : 'W'}</i>{index === 0 ? `Seed ${match * 2 + 1}` : 'Previous winner'}</span>
                    <span><i>{index === 0 ? match * 2 + 2 : 'W'}</i>{index === 0 ? `Seed ${match * 2 + 2}` : 'Previous winner'}</span>
                  </div>
                ))}
                {matches > visibleMatches && <div className="bracket-more">+ {(matches - visibleMatches).toLocaleString()} more matches</div>}
              </div>
            </section>
          );
        })}
        <section className="bracket-round bracket-winner">
          <header><span>Winner</span><b>Champion</b></header>
          <div className="winner-node">♛<span>QQURZ Champion</span></div>
        </section>
      </div>
    </div>
  );
}

export default function TournamentHub({ onBack, onPlayOnline, onShow3D }: Props) {
  const [catalog, setCatalog] = useState<TournamentCatalog>({
    tournaments: FALLBACK_TOURNAMENTS,
    paymentMode: 'off',
    paymentConfigured: false,
    liveTournamentPaymentsEnabled: false,
    cashTournamentCheckoutMode: 'test-only',
    platformRakeBps: PLATFORM_RAKE_BPS,
    premium3dPriceCents: 499,
  });
  const [selectedSeats, setSelectedSeats] = useState<number>(16);
  const [selectedEntry, setSelectedEntry] = useState<number>(1_000);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [verifiedItem, setVerifiedItem] = useState('');

  const refreshCatalog = async () => {
    const value = await loadTournamentCatalog();
    setCatalog(value);
    return value;
  };

  useEffect(() => {
    let active = true;
    loadTournamentCatalog()
      .then(value => { if (active) setCatalog(value); })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load tournaments.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId || params.get('checkout') !== 'success' || params.get('kind') !== 'tournament') return;
    setMessage('Verifying tournament entry and reserving your seed…');
    verifyCheckout(sessionId)
      .then(async result => {
        if (!result.paid || result.kind !== 'tournament') throw new Error('Tournament payment has not completed yet.');
        const parsed = /^knockout-(\d+)-(\d+)$/.exec(result.itemId);
        if (parsed) {
          setSelectedSeats(Number(parsed[1]));
          setSelectedEntry(Number(parsed[2]));
        }
        const registration = await registerTournament(sessionId, profileName());
        setVerifiedItem(result.itemId);
        const nextCatalog = await refreshCatalog();
        const event = nextCatalog.tournaments.find(value => value.id === result.itemId);
        setMessage(
          `${result.paymentMode === 'live' ? 'Payment' : 'Test payment'} verified · registration ${registration.registrationId.slice(-8).toUpperCase()} · ` +
          `${registration.registeredSeats.toLocaleString()}/${registration.seats.toLocaleString()} seats filled${registration.status === 'ready' ? ' · bracket READY TO PLAY.' : '.'}`,
        );
        if (event) {
          setSelectedSeats(event.seats);
          setSelectedEntry(event.entryCents);
        }
        const url = new URL(window.location.href);
        ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url);
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Could not verify or register tournament entry.'));
  }, []);

  const selectedId = tournamentId(selectedSeats, selectedEntry);
  const selectedEvent = useMemo(
    () => catalog.tournaments.find(event => event.id === selectedId)
      ?? FALLBACK_TOURNAMENTS.find(event => event.id === selectedId)
      ?? FALLBACK_TOURNAMENTS[0],
    [catalog.tournaments, selectedId],
  );

  const byId = useMemo(() => new Map(catalog.tournaments.map(event => [event.id, event])), [catalog.tournaments]);

  const backendLabel = useMemo(() => {
    if (!multiplayerConfigured) return 'Backend not connected';
    if (catalog.paymentMode === 'test' && catalog.paymentConfigured) return 'Stripe test registry ready';
    if (catalog.paymentMode === 'live') return 'Realtime ready · cash tournament checkout blocked';
    return 'Realtime ready · payments off';
  }, [catalog.paymentConfigured, catalog.paymentMode]);

  const selectSeats = (seats: number) => {
    setSelectedSeats(seats);
    if (seats === ANNUAL_CHAMPIONSHIP_SEATS) setSelectedEntry(ANNUAL_CHAMPIONSHIP_ENTRY_CENTS);
  };

  const selectEntry = (entryCents: number) => {
    if (!isTournamentCombinationAvailable(selectedSeats, entryCents)) return;
    setSelectedEntry(entryCents);
  };

  const checkout = async (itemId: string) => {
    setBusyId(itemId);
    setMessage('');
    try {
      const url = await createCheckout(itemId, 'tournament');
      window.location.assign(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start checkout.');
      setBusyId('');
    }
  };

  const openVerifiedMatch = (event: React.MouseEvent<HTMLButtonElement>) => {
    celebratePurchase(event.currentTarget);
    try { sessionStorage.setItem('qqurz:selected-tournament', JSON.stringify(asSelection(selectedEvent))); } catch { /* optional */ }
    onPlayOnline();
  };

  const firstMoveSeconds = firstMoveAllowanceSeconds(selectedEvent.baseMinutes, selectedEvent.incrementSeconds);
  const disconnectSeconds = disconnectAllowanceSeconds(selectedEvent.baseMinutes, selectedEvent.incrementSeconds);
  const earlyMoveSeconds = earlyMoveLimitSeconds(selectedEvent.baseMinutes);
  const seatsRemaining = Math.max(0, selectedEvent.seats - (selectedEvent.registeredSeats ?? 0));
  const annual = isAnnualChampionship(selectedEvent.seats, selectedEvent.entryCents);
  const canCheckout = selectedEvent.registrationOpen
    && catalog.paymentConfigured
    && catalog.paymentMode === 'test'
    && !busyId;

  return (
    <div className="tournament-page-v21 qqurz-content-page">
      <section className="page-heading-v14 tournament-master-heading">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">QQURZ MASTER TOURNAMENT GRID</span>
        <h1>Fewer choices. Faster fills. One consistent 20% platform fee.</h1>
        <p>Regular fields run from 16 through 2,048 players with only five entry tiers: $10, $20, $50, $100 and $500. The 4,096-player QQURZ Chess Cup is a separate, operator-controlled annual championship.</p>
        <div className="status-row-v14">
          <span className={multiplayerConfigured ? 'ok' : ''}>{backendLabel}</span>
          <span>20% QQURZ fee · 80% player prize pool</span>
          <span className="ready-legend"><i /> Green = full / ready to play</span>
        </div>
      </section>

      <section className="tournament-step-card">
        <div className="step-heading"><span>01</span><div><b>Select field size</b><small>4,096 is reserved for the once-a-year QQURZ Chess Cup.</small></div></div>
        <div className="seed-selector" role="radiogroup" aria-label="Tournament seed count">
          {TOURNAMENT_SEEDS.map(seats => (
            <button key={seats} className={selectedSeats === seats ? 'selected' : ''} onClick={() => selectSeats(seats)}>
              <b>{seats.toLocaleString()}</b><span>{seats === ANNUAL_CHAMPIONSHIP_SEATS ? 'annual cup' : 'seeds'}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tournament-step-card">
        <div className="step-heading"><span>02</span><div><b>Select entrance fee</b><small>Only the five approved values remain in the grid.</small></div></div>
        <div className="entry-selector" role="radiogroup" aria-label="Tournament entry fee">
          {TOURNAMENT_ENTRY_CENTS.map(cents => {
            const available = isTournamentCombinationAvailable(selectedSeats, cents);
            return (
              <button key={cents} disabled={!available} className={selectedEntry === cents ? 'selected' : ''} onClick={() => selectEntry(cents)}>
                {money(cents)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="master-grid-card">
        <header>
          <div><span className="qqurz-kicker">CONDENSED MASTER GRID</span><h2>Field × entrance fee</h2></div>
          <div className="grid-legend"><span><i className="open" />Open</span><span><i className="filling" />Filling</span><span><i className="ready" />Ready</span></div>
        </header>
        <div className="master-grid-scroll">
          <table className="tournament-master-grid">
            <thead><tr><th>Entry</th>{TOURNAMENT_SEEDS.map(seats => <th key={seats}>{seats.toLocaleString()}<small>{seats === ANNUAL_CHAMPIONSHIP_SEATS ? 'annual' : 'seed'}</small></th>)}</tr></thead>
            <tbody>
              {TOURNAMENT_ENTRY_CENTS.map(entry => (
                <tr key={entry}>
                  <th>{money(entry)}</th>
                  {TOURNAMENT_SEEDS.map(seats => {
                    const available = isTournamentCombinationAvailable(seats, entry);
                    const event = available ? byId.get(tournamentId(seats, entry)) : undefined;
                    const registered = event?.registeredSeats ?? 0;
                    const status = event?.status ?? 'open';
                    const selected = seats === selectedSeats && entry === selectedEntry;
                    return (
                      <td key={seats}>
                        <button
                          disabled={!available}
                          className={`${status} ${selected ? 'selected' : ''}`}
                          onClick={() => { if (available) { setSelectedSeats(seats); setSelectedEntry(entry); } }}
                          aria-label={available ? `${seats} seed ${money(entry)} entry tournament, ${registered} of ${seats} registered` : 'Unavailable annual championship combination'}
                        >
                          {available ? <><b>{registered.toLocaleString()}/{seats.toLocaleString()}</b><span>{status === 'ready' ? 'READY' : status === 'filling' ? 'FILLING' : shortMoney(seats * entry)}</span></> : <><b>—</b><span>ANNUAL ONLY</span></>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`selected-tournament-card ${selectedEvent.status === 'ready' ? 'ready' : ''}`}>
        <div className="selected-event-main">
          <span className="qqurz-kicker">SELECTED TOURNAMENT</span>
          <h2>{selectedEvent.name}</h2>
          <p>{selectedEvent.format} · {selectedEvent.timeControl} · {selectedEvent.rounds} rounds from opening bracket to champion.</p>
          <div className="selected-event-stats">
            <div><span>Field</span><b>{selectedEvent.seats.toLocaleString()} seeds</b></div>
            <div><span>Entry fee</span><b>{money(selectedEvent.entryCents)}</b></div>
            <div><span>Gross at full field</span><b>{money(selectedEvent.grossCents)}</b></div>
            <div><span>QQURZ fee · 20%</span><b>{money(selectedEvent.platformFeeCents)}</b></div>
            <div><span>Player prize pool · 80%</span><b>{money(selectedEvent.prizePoolCents)}</b></div>
            <div><span>Paid places</span><b>Top {selectedEvent.paidPlaces.toLocaleString()}</b></div>
            <div><span>Registered</span><b>{(selectedEvent.registeredSeats ?? 0).toLocaleString()} / {selectedEvent.seats.toLocaleString()}</b></div>
            <div><span>Still needed</span><b>{seatsRemaining.toLocaleString()}</b></div>
            <div><span>Status</span><b className={`status-text ${selectedEvent.status}`}>{annual ? 'ANNUAL · OPERATOR CONTROLLED' : selectedEvent.status === 'ready' ? 'READY TO PLAY' : selectedEvent.status.toUpperCase()}</b></div>
          </div>
          {annual ? (
            <small className="money-separation-note">
              The $500 × 4,096 field produces {money(selectedEvent.grossCents)} gross and {money(selectedEvent.prizePoolCents)} after the 20% fee. A guaranteed {money(selectedEvent.guaranteedPrizeCents ?? 0)} prize fund therefore needs {money(selectedEvent.guaranteeFundingGapCents ?? 0)} in sponsor/operator funding before registration opens.
            </small>
          ) : (
            <small className="money-separation-note">Accounting is deterministic: each completed buy-in allocates 20% to QQURZ and 80% to the tournament prize pool. Cash collection remains test-only until an approved tournament payment provider and jurisdiction controls are in place.</small>
          )}
        </div>
        <div className="selected-event-action">
          {verifiedItem === selectedEvent.id ? (
            <button className="primary-black" onClick={openVerifiedMatch}>✓ Registered · open tournament room</button>
          ) : (
            <button className="primary-black" onClick={() => checkout(selectedEvent.id)} disabled={!canCheckout}>
              {annual ? 'Annual cup · registration controlled by QQURZ' : busyId === selectedEvent.id ? 'Opening secure test checkout…' : `Test tournament entry · ${money(selectedEvent.entryCents)}`}
            </button>
          )}
          <small>{annual ? 'The annual event does not open from the public grid.' : catalog.paymentMode === 'test' ? 'Stripe test mode only; no real tournament money is collected.' : catalog.complianceNotice ?? 'Cash tournament checkout is unavailable.'}</small>
        </div>
      </section>

      <section className="timing-rules-card">
        <header><div><span className="qqurz-kicker">AUTOMATED PAYOUT CURVE</span><h2>{money(selectedEvent.prizePoolCents)} distributed across {selectedEvent.paidPlaces.toLocaleString()} places</h2></div><span className="clock-rule-chip">100% OF PLAYER POOL</span></header>
        <div className="timing-rule-grid">
          {selectedEvent.payoutGroups.map(group => (
            <article key={group.label}>
              <span>{group.label}</span>
              <b>{group.recipients === 1 ? money(group.groupCents) : `${money(group.eachCents)} each`}</b>
              <p>{(group.poolBps / 100).toFixed(group.poolBps % 100 ? 1 : 0)}% of the player pool{group.bonusRecipients ? ` · top ${group.bonusRecipients} in this tier receive one extra cent` : ''}.</p>
            </article>
          ))}
        </div>
        <small className="rule-source-note">The previous 64- and 128-player examples exceeded 100% of the prize pool by 16%. This implementation uses validated curves that always total exactly 100%, with exact-cent remainder handling.</small>
      </section>

      <section className="bracket-card-v21">
        <header><div><span className="qqurz-kicker">FULL ROUND STRUCTURE</span><h2>{selectedEvent.seats.toLocaleString()} seeds → {bracketRounds(selectedEvent.seats)} rounds → one winner</h2></div><span className="bracket-chip">Single elimination</span></header>
        <BracketPreview seats={selectedEvent.seats} />
      </section>

      <section className="timing-rules-card">
        <header><div><span className="qqurz-kicker">TOURNAMENT CLOCK STANDARD</span><h2>{selectedEvent.timeControl} server-authoritative timing</h2></div><span className="clock-rule-chip">X + Y</span></header>
        <div className="timing-rule-grid">
          <article><span>Base clock · X</span><b>{selectedEvent.baseMinutes} min</b><p>Each player starts with the same base time.</p></article>
          <article><span>Increment · Y</span><b>+{selectedEvent.incrementSeconds}s</b><p>Added after the player completes the move and presses the physical 3D clock.</p></article>
          <article><span>Opening move timer</span><b>{firstMoveSeconds}s</b><p>Anti-stall first-move allowance for this speed class.</p></article>
          <article><span>Moves 1–10 anti-stall</span><b>{Math.floor(earlyMoveSeconds / 60)}:{String(earlyMoveSeconds % 60).padStart(2, '0')}</b><p>Using more than 50% of base time on one early move can trigger abandonment.</p></article>
          <article><span>Disconnect allowance</span><b>{Math.floor(disconnectSeconds / 60)}:{String(disconnectSeconds % 60).padStart(2, '0')}</b><p>(base seconds + 40 × increment) × 10%, clamped from 30 seconds to 3 minutes.</p></article>
          <article><span>Clearly lost disconnect</span><b>0:15</b><p>A severe losing-position disconnect can use the shorter 15-second abandonment window.</p></article>
        </div>
        <div className="round-clock-flow"><span>Round starts</span><i>→</i><span>all pairings play</span><i>→</i><span>all games finish</span><i>→</i><span>next round unlocks</span></div>
      </section>

      <section className="tournament-visual-standard" aria-label="QQURZ tournament board standard">
        <div className="tournament-mini-board" aria-hidden="true">{Array.from({ length: 64 }, (_, index) => <i key={index} />)}</div>
        <div><span className="qqurz-kicker">TOURNAMENT BOARD STANDARD</span><h2>Park green + warm ivory.</h2><p>Official QQURZ tournament rooms use the green-and-white board plus the same true 3D tournament clock used elsewhere in the app.</p><div className="tournament-color-chips"><span><i className="green"/>Tournament green</span><span><i className="ivory"/>Warm ivory</span></div></div>
      </section>

      <section className="premium-callout-v14">
        <div><span className="qqurz-kicker">PREMIUM 3D</span><h2>3D is a separate {money(catalog.premium3dPriceCents)} unlock.</h2><p>The physical clock model stays consistent across 2D boards and Premium 3D; Premium unlocks the full 3D board renderer.</p></div>
        <button onClick={onShow3D}>Unlock 3D · {money(catalog.premium3dPriceCents)}</button>
      </section>

      {!multiplayerConfigured && <p className="setup-note-v14">Deploy the included Cloudflare Worker/Durable Object backend and set <code>VITE_MULTIPLAYER_API</code> to enable live fill counts, test registration and authoritative tournament rooms.</p>}
      {message && <div className="inline-message-v14" role="status">{message}</div>}
    </div>
  );
}
