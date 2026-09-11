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

type DetailTab = 'prizes' | 'grid' | 'bracket' | 'rules';

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

function shortMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 1)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}K`;
  return money(cents);
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
    timeControlTemplateId: event.timeControlTemplateId,
    allowedTimeControls: event.allowedTimeControls,
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
    <div className="master-bracket-scroll" aria-label={`${seats}-player bracket`}>
      <div className="master-bracket simple-bracket-v22" style={{ '--bracket-rounds': rounds } as React.CSSProperties}>
        {Array.from({ length: rounds }, (_, index) => {
          const matches = seats / (2 ** (index + 1));
          const visibleMatches = Math.min(matches, 4);
          return (
            <section className="bracket-round" key={index}>
              <header><span>{roundLabel(index, rounds)}</span><b>{matches.toLocaleString()} {matches === 1 ? 'match' : 'matches'}</b></header>
              <div className="bracket-nodes">
                {Array.from({ length: visibleMatches }, (_, match) => (
                  <div className="bracket-match" key={match}>
                    <span><i>{index === 0 ? match * 2 + 1 : 'W'}</i>{index === 0 ? `Seed ${match * 2 + 1}` : 'Winner'}</span>
                    <span><i>{index === 0 ? match * 2 + 2 : 'W'}</i>{index === 0 ? `Seed ${match * 2 + 2}` : 'Winner'}</span>
                  </div>
                ))}
                {matches > visibleMatches && <div className="bracket-more">+ {(matches - visibleMatches).toLocaleString()} more</div>}
              </div>
            </section>
          );
        })}
        <section className="bracket-round bracket-winner">
          <header><span>Champion</span><b>1 player</b></header>
          <div className="winner-node">♛<span>QQURZ Champion</span></div>
        </section>
      </div>
    </div>
  );
}

export default function TournamentHub({ onBack, onPlayOnline }: Props) {
  const [catalog, setCatalog] = useState<TournamentCatalog>({
    tournaments: FALLBACK_TOURNAMENTS,
    paymentMode: 'off',
    paymentConfigured: false,
    liveTournamentPaymentsEnabled: false,
    cashTournamentCheckoutMode: 'test-only',
    platformRakeBps: PLATFORM_RAKE_BPS,
    premium3dPriceCents: 499,
  });
  const [selectedSeats, setSelectedSeats] = useState<number>(32);
  const [selectedEntry, setSelectedEntry] = useState<number>(1_000);
  const [activeTab, setActiveTab] = useState<DetailTab>('prizes');
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
    setMessage('Verifying your entry…');
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
        if (event) {
          setSelectedSeats(event.seats);
          setSelectedEntry(event.entryCents);
        }
        setMessage(`Entry confirmed · ${registration.registeredSeats.toLocaleString()} of ${registration.seats.toLocaleString()} players registered.`);
        const url = new URL(window.location.href);
        ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url);
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Could not verify your entry.'));
  }, []);

  const selectedId = tournamentId(selectedSeats, selectedEntry);
  const selectedEvent = useMemo(
    () => catalog.tournaments.find(event => event.id === selectedId)
      ?? FALLBACK_TOURNAMENTS.find(event => event.id === selectedId)
      ?? FALLBACK_TOURNAMENTS[0],
    [catalog.tournaments, selectedId],
  );
  const byId = useMemo(() => new Map(catalog.tournaments.map(event => [event.id, event])), [catalog.tournaments]);

  const selectSeats = (seats: number) => {
    setSelectedSeats(seats);
    if (seats === ANNUAL_CHAMPIONSHIP_SEATS) setSelectedEntry(ANNUAL_CHAMPIONSHIP_ENTRY_CENTS);
    else if (!isTournamentCombinationAvailable(seats, selectedEntry)) setSelectedEntry(TOURNAMENT_ENTRY_CENTS[0]);
  };

  const checkout = async () => {
    setBusyId(selectedEvent.id);
    setMessage('');
    try {
      const url = await createCheckout(selectedEvent.id, 'tournament');
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
  const annual = isAnnualChampionship(selectedEvent.seats, selectedEvent.entryCents);
  const registered = selectedEvent.registeredSeats ?? 0;
  const progress = Math.min(100, Math.round((registered / selectedEvent.seats) * 100));
  const firstPrize = selectedEvent.payoutGroups?.[0]?.eachCents ?? 0;
  const canCheckout = selectedEvent.registrationOpen && catalog.paymentConfigured && catalog.paymentMode === 'test' && !busyId;

  return (
    <div className="tournament-page-v21 tournament-page-v22 qqurz-content-page">
      <section className="tournament-title-v22">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">TOURNAMENTS</span>
        <h1>Pick. Enter. Play.</h1>
        <p>Choose a field size and entry tier. Everything else is shown only when you ask for it.</p>
      </section>

      <section className="tournament-picker-v22" aria-label="Choose tournament">
        <div className="picker-group-v22">
          <div className="picker-label-v22"><b>1. Players</b><span>{selectedSeats.toLocaleString()} selected</span></div>
          <div className="seed-selector seed-selector-v22" role="radiogroup" aria-label="Player count">
            {TOURNAMENT_SEEDS.map(seats => (
              <button key={seats} className={selectedSeats === seats ? 'selected' : ''} onClick={() => selectSeats(seats)} aria-pressed={selectedSeats === seats}>
                <b>{seats.toLocaleString()}</b><span>{seats === ANNUAL_CHAMPIONSHIP_SEATS ? 'Annual Cup' : 'players'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="picker-group-v22">
          <div className="picker-label-v22"><b>2. Entry</b><span>{money(selectedEntry)} selected</span></div>
          <div className="entry-selector entry-selector-v22" role="radiogroup" aria-label="Entry fee">
            {TOURNAMENT_ENTRY_CENTS.map(cents => {
              const available = isTournamentCombinationAvailable(selectedSeats, cents);
              return (
                <button key={cents} disabled={!available} className={selectedEntry === cents ? 'selected' : ''} onClick={() => available && setSelectedEntry(cents)} aria-pressed={selectedEntry === cents}>
                  {money(cents)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className={`tournament-summary-v22 ${selectedEvent.status === 'ready' ? 'ready' : ''}`}>
        <div className="summary-main-v22">
          <div className="summary-heading-v22">
            <div><span className="qqurz-kicker">YOUR TOURNAMENT</span><h2>{selectedEvent.name}</h2></div>
            <span className={`summary-status-v22 ${selectedEvent.status}`}>{selectedEvent.status === 'ready' ? 'Ready' : selectedEvent.status === 'filling' ? 'Filling' : annual ? 'Annual' : 'Open'}</span>
          </div>

          <div className="tournament-progress-v22" aria-label={`${registered} of ${selectedEvent.seats} registered`}>
            <div><span>Players</span><b>{registered.toLocaleString()} / {selectedEvent.seats.toLocaleString()}</b></div>
            <div className="progress-track-v22"><i style={{ width: `${progress}%` }} /></div>
          </div>

          <div className="summary-stats-v22">
            <div><span>Entry</span><strong>{money(selectedEvent.entryCents)}</strong></div>
            <div><span>Prize pool</span><strong>{money(selectedEvent.prizePoolCents)}</strong></div>
            <div><span>1st place</span><strong>{money(firstPrize)}</strong></div>
            <div><span>QQURZ fee</span><strong>20%</strong></div>
          </div>

          {annual && (
            <div className="annual-note-v22">
              <b>$2,000,000 annual guarantee</b>
              <span>Entry-funded pool: {money(selectedEvent.prizePoolCents)} · outside funding required: {money(selectedEvent.guaranteeFundingGapCents ?? 0)}</span>
            </div>
          )}
        </div>

        <div className="summary-action-v22">
          {verifiedItem === selectedEvent.id ? (
            <button className="primary-black enter-tournament-v22" onClick={openVerifiedMatch}>Open tournament room <span>→</span></button>
          ) : (
            <button className="primary-black enter-tournament-v22" onClick={checkout} disabled={!canCheckout}>
              {busyId ? 'Opening checkout…' : annual ? 'Annual registration not open' : `Enter for ${money(selectedEvent.entryCents)}`}
            </button>
          )}
          <p>{catalog.paymentMode === 'test' ? 'Test checkout only. No real tournament money is collected.' : multiplayerConfigured ? 'Tournament checkout is not available right now.' : 'Connect the realtime server to enable registration.'}</p>
        </div>
      </section>

      {message && <div className="inline-message-v14 tournament-message-v22" role="status">{message}</div>}

      <section className="tournament-details-v22">
        <div className="detail-tabs-v22" role="tablist" aria-label="Tournament details">
          {([
            ['prizes', 'Prizes'],
            ['grid', 'All events'],
            ['bracket', 'Bracket'],
            ['rules', 'Clock rules'],
          ] as [DetailTab, string][]).map(([tab, label]) => (
            <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{label}</button>
          ))}
        </div>

        <div className="detail-panel-v22" role="tabpanel">
          {activeTab === 'prizes' && (
            <div className="prize-panel-v22">
              <div className="detail-heading-v22"><div><span className="qqurz-kicker">PRIZE BREAKDOWN</span><h2>{money(selectedEvent.prizePoolCents)} player pool</h2></div><span>Top {selectedEvent.paidPlaces.toLocaleString()} paid</span></div>
              <div className="payout-list-v22">
                {selectedEvent.payoutGroups.map(group => (
                  <div key={group.label}>
                    <span>{group.label}</span>
                    <strong>{money(group.eachCents)}{group.recipients > 1 ? ' each' : ''}</strong>
                    {group.bonusRecipients > 0 && <small>+1¢ to the first {group.bonusRecipients} in this group</small>}
                  </div>
                ))}
              </div>
              <div className="money-summary-v22"><span>Full field gross <b>{money(selectedEvent.grossCents)}</b></span><span>QQURZ 20% <b>{money(selectedEvent.platformFeeCents)}</b></span><span>Players 80% <b>{money(selectedEvent.prizePoolCents)}</b></span></div>
            </div>
          )}

          {activeTab === 'grid' && (
            <div className="grid-panel-v22">
              <div className="detail-heading-v22"><div><span className="qqurz-kicker">ALL EVENTS</span><h2>Find another tournament</h2></div><span>Tap any available cell</span></div>
              <div className="master-grid-scroll">
                <table className="tournament-master-grid tournament-master-grid-v22">
                  <thead><tr><th>Entry</th>{TOURNAMENT_SEEDS.map(seats => <th key={seats}>{seats.toLocaleString()}<small>{seats === ANNUAL_CHAMPIONSHIP_SEATS ? 'annual' : 'players'}</small></th>)}</tr></thead>
                  <tbody>
                    {TOURNAMENT_ENTRY_CENTS.map(entry => (
                      <tr key={entry}>
                        <th>{money(entry)}</th>
                        {TOURNAMENT_SEEDS.map(seats => {
                          const available = isTournamentCombinationAvailable(seats, entry);
                          const event = available ? byId.get(tournamentId(seats, entry)) : undefined;
                          const eventRegistered = event?.registeredSeats ?? 0;
                          const status = event?.status ?? 'open';
                          const selected = seats === selectedSeats && entry === selectedEntry;
                          return (
                            <td key={seats}>
                              <button disabled={!available} className={`${status} ${selected ? 'selected' : ''}`} onClick={() => { if (available) { setSelectedSeats(seats); setSelectedEntry(entry); setActiveTab('prizes'); } }}>
                                {available ? <><b>{eventRegistered.toLocaleString()}/{seats.toLocaleString()}</b><span>{status === 'ready' ? 'READY' : shortMoney(seats * entry)}</span></> : <><b>—</b><span>Annual only</span></>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'bracket' && (
            <div className="bracket-panel-v22">
              <div className="detail-heading-v22"><div><span className="qqurz-kicker">BRACKET</span><h2>{selectedEvent.rounds} rounds to win</h2></div><span>{selectedEvent.seats.toLocaleString()} players</span></div>
              <BracketPreview seats={selectedEvent.seats} />
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="rules-panel-v22">
              <div className="detail-heading-v22"><div><span className="qqurz-kicker">CLOCK RULES</span><h2>{selectedEvent.timeControl} tournament clock</h2></div><span>Server authoritative</span></div>
              <div className="timing-rule-grid timing-rule-grid-v22">
                <article><span>Game clock</span><b>{selectedEvent.baseMinutes}+{selectedEvent.incrementSeconds}</b><p>{selectedEvent.baseMinutes} minutes each, plus {selectedEvent.incrementSeconds} seconds after a completed move.</p></article>
                <article><span>Allowed controls</span><b>{selectedEvent.allowedTimeControls.join(' · ')}</b><p>This tournament template rejects custom controls and any clock outside this list.</p></article>
                <article><span>First move</span><b>{firstMoveSeconds}s</b><p>Opening anti-stall allowance for this speed.</p></article>
                <article><span>Early move limit</span><b>{Math.floor(earlyMoveSeconds / 60)}:{String(earlyMoveSeconds % 60).padStart(2, '0')}</b><p>During the first ten moves, using more than half the base time on one move can trigger abandonment.</p></article>
                <article><span>Disconnect</span><b>{Math.floor(disconnectSeconds / 60)}:{String(disconnectSeconds % 60).padStart(2, '0')}</b><p>Reconnect before the server abandonment window expires.</p></article>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
