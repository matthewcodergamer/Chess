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
  TOURNAMENT_ENTRY_CENTS,
  TOURNAMENT_SEEDS,
  bracketRounds,
  disconnectAllowanceSeconds,
  earlyMoveLimitSeconds,
  firstMoveAllowanceSeconds,
  registrationTotalCents,
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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

function shortMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 1)}M`;
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
    premium3dPriceCents: 499,
  });
  const [selectedSeats, setSelectedSeats] = useState<number>(16);
  const [selectedEntry, setSelectedEntry] = useState<number>(100);
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
    () => catalog.tournaments.find(event => event.id === selectedId) ?? FALLBACK_TOURNAMENTS.find(event => event.id === selectedId)!,
    [catalog.tournaments, selectedId],
  );

  const byId = useMemo(() => new Map(catalog.tournaments.map(event => [event.id, event])), [catalog.tournaments]);

  const backendLabel = useMemo(() => {
    if (!multiplayerConfigured) return 'Backend not connected';
    if (catalog.paymentConfigured && catalog.paymentMode === 'live' && catalog.liveTournamentPaymentsEnabled) return 'Live tournament payments enabled';
    if (catalog.paymentConfigured && catalog.paymentMode === 'live') return 'Realtime ready · live entries gated';
    if (catalog.paymentConfigured && catalog.paymentMode === 'test') return 'Stripe test tournament registry ready';
    return 'Realtime ready · payments off';
  }, [catalog.liveTournamentPaymentsEnabled, catalog.paymentConfigured, catalog.paymentMode]);

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
  const fullRegistration = selectedEvent.fullRegistrationCents || registrationTotalCents(selectedSeats, selectedEntry);
  const seatsRemaining = Math.max(0, selectedSeats - (selectedEvent.registeredSeats ?? 0));

  return (
    <div className="tournament-page-v21 qqurz-content-page">
      <section className="page-heading-v14 tournament-master-heading">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">QQURZ MASTER TOURNAMENT GRID</span>
        <h1>Select the seed. Select the entrance fee. See the full road to the final.</h1>
        <p>The handwritten master-grid idea is now the actual tournament selector: powers-of-two fields from 16 through 4,096 seeds, entry tiers from $1 through $500, a bracket preview, live fill status and tournament clock rules.</p>
        <div className="status-row-v14">
          <span className={multiplayerConfigured ? 'ok' : ''}>{backendLabel}</span>
          <span>Single-elimination · Chess960</span>
          <span className="ready-legend"><i /> Green = full / ready to play</span>
        </div>
      </section>

      <section className="tournament-step-card">
        <div className="step-heading"><span>01</span><div><b>Select seed count</b><small>Every field is a full power-of-two knockout bracket.</small></div></div>
        <div className="seed-selector" role="radiogroup" aria-label="Tournament seed count">
          {TOURNAMENT_SEEDS.map(seats => (
            <button key={seats} className={selectedSeats === seats ? 'selected' : ''} onClick={() => setSelectedSeats(seats)}>
              <b>{seats.toLocaleString()}</b><span>seeds</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tournament-step-card">
        <div className="step-heading"><span>02</span><div><b>Select entrance fee</b><small>The full-field total is shown separately from any published prize schedule.</small></div></div>
        <div className="entry-selector" role="radiogroup" aria-label="Tournament entry fee">
          {TOURNAMENT_ENTRY_CENTS.map(cents => (
            <button key={cents} className={selectedEntry === cents ? 'selected' : ''} onClick={() => setSelectedEntry(cents)}>
              {money(cents)}
            </button>
          ))}
        </div>
      </section>

      <section className="master-grid-card">
        <header>
          <div><span className="qqurz-kicker">FULL MASTER GRID</span><h2>Seed × entrance fee</h2></div>
          <div className="grid-legend"><span><i className="open" />Open</span><span><i className="filling" />Filling</span><span><i className="ready" />Ready</span></div>
        </header>
        <div className="master-grid-scroll">
          <table className="tournament-master-grid">
            <thead><tr><th>Entry</th>{TOURNAMENT_SEEDS.map(seats => <th key={seats}>{seats.toLocaleString()}<small>seed</small></th>)}</tr></thead>
            <tbody>
              {TOURNAMENT_ENTRY_CENTS.map(entry => (
                <tr key={entry}>
                  <th>{money(entry)}</th>
                  {TOURNAMENT_SEEDS.map(seats => {
                    const event = byId.get(tournamentId(seats, entry));
                    const registered = event?.registeredSeats ?? 0;
                    const status = event?.status ?? 'open';
                    const selected = seats === selectedSeats && entry === selectedEntry;
                    return (
                      <td key={seats}>
                        <button
                          className={`${status} ${selected ? 'selected' : ''}`}
                          onClick={() => { setSelectedSeats(seats); setSelectedEntry(entry); }}
                          aria-label={`${seats} seed ${money(entry)} entry tournament, ${registered} of ${seats} registered`}
                        >
                          <b>{registered.toLocaleString()}/{seats.toLocaleString()}</b>
                          <span>{status === 'ready' ? 'READY' : status === 'filling' ? 'FILLING' : shortMoney(seats * entry)}</span>
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
            <div><span>Field</span><b>{selectedSeats.toLocaleString()} seeds</b></div>
            <div><span>Entry fee</span><b>{money(selectedEntry)}</b></div>
            <div><span>Full-field registration total</span><b>{money(fullRegistration)}</b></div>
            <div><span>Registered</span><b>{(selectedEvent.registeredSeats ?? 0).toLocaleString()} / {selectedSeats.toLocaleString()}</b></div>
            <div><span>Still needed</span><b>{seatsRemaining.toLocaleString()}</b></div>
            <div><span>Status</span><b className={`status-text ${selectedEvent.status}`}>{selectedEvent.status === 'ready' ? 'READY TO PLAY' : selectedEvent.status.toUpperCase()}</b></div>
          </div>
          <small className="money-separation-note">The full-field registration total is arithmetic only; it is not automatically the winner payout. A live money-prize event must publish its guaranteed prize fund and distribution separately in its Official Rules.</small>
        </div>
        <div className="selected-event-action">
          {verifiedItem === selectedEvent.id ? (
            <button className="primary-black" onClick={openVerifiedMatch}>✓ Registered · open tournament room</button>
          ) : (
            <button className="primary-black" onClick={() => checkout(selectedEvent.id)} disabled={!catalog.paymentConfigured || catalog.paymentMode === 'off' || Boolean(busyId)}>
              {busyId === selectedEvent.id ? 'Opening secure checkout…' : `Enter tournament · ${money(selectedEvent.entryCents)}`}
            </button>
          )}
          <small>
            {catalog.paymentMode === 'live'
              ? catalog.liveTournamentPaymentsEnabled ? 'Live entry collection is enabled by server policy.' : 'Live tournament payments are still gated off.'
              : catalog.paymentMode === 'test' ? 'Stripe test mode: no real tournament fee is charged.' : 'Connect the realtime backend to enable registration.'}
          </small>
        </div>
      </section>

      <section className="bracket-card-v21">
        <header><div><span className="qqurz-kicker">FULL ROUND STRUCTURE</span><h2>{selectedSeats.toLocaleString()} seeds → {bracketRounds(selectedSeats)} rounds → one winner</h2></div><span className="bracket-chip">Single elimination</span></header>
        <BracketPreview seats={selectedSeats} />
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
        <small className="rule-source-note">QQURZ uses these as its tournament timing policy model; the game server remains the authority for actual clock state, timeouts and move completion.</small>
      </section>

      <section className="tournament-visual-standard" aria-label="QQURZ tournament board standard">
        <div className="tournament-mini-board" aria-hidden="true">{Array.from({ length: 64 }, (_, index) => <i key={index} />)}</div>
        <div><span className="qqurz-kicker">TOURNAMENT BOARD STANDARD</span><h2>Park green + warm ivory.</h2><p>Official QQURZ tournament rooms use the green-and-white board plus the same true 3D tournament clock used elsewhere in the app.</p><div className="tournament-color-chips"><span><i className="green"/>Tournament green</span><span><i className="ivory"/>Warm ivory</span></div></div>
      </section>

      <section className="premium-callout-v14">
        <div><span className="qqurz-kicker">PREMIUM 3D</span><h2>3D is a separate {money(catalog.premium3dPriceCents)} unlock.</h2><p>The physical clock model stays consistent across 2D boards and Premium 3D; Premium unlocks the full 3D board renderer.</p></div>
        <button onClick={onShow3D}>Unlock 3D · {money(catalog.premium3dPriceCents)}</button>
      </section>

      {!multiplayerConfigured && <p className="setup-note-v14">Deploy the included Cloudflare Worker/Durable Object backend and set <code>VITE_MULTIPLAYER_API</code> to enable live fill counts, registration and authoritative tournament rooms.</p>}
      {message && <div className="inline-message-v14" role="status">{message}</div>}
    </div>
  );
}
