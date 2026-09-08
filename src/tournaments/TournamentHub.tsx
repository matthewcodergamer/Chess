import { useEffect, useMemo, useState } from 'react';
import { multiplayerConfigured } from '../multiplayer/client';
import { celebratePurchase } from '../ui/purchaseCelebration';
import { createCheckout, FALLBACK_TOURNAMENTS, loadTournamentCatalog, verifyCheckout, type TournamentCatalog } from './client';

type Props = {
  onBack: () => void;
  onPlayOnline: () => void;
  onShow3D: () => void;
};

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function TournamentHub({ onBack, onPlayOnline, onShow3D }: Props) {
  const [catalog, setCatalog] = useState<TournamentCatalog>({
    tournaments: FALLBACK_TOURNAMENTS,
    paymentMode: 'off',
    paymentConfigured: false,
    premium3dPriceCents: 499,
  });
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [verifiedItem, setVerifiedItem] = useState('');

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
    if (!sessionId || params.get('checkout') !== 'success' || params.get('kind') === 'premium3d') return;
    setMessage('Verifying checkout…');
    verifyCheckout(sessionId)
      .then(result => {
        if (!result.paid || result.kind !== 'tournament') throw new Error('Tournament payment has not completed yet.');
        setVerifiedItem(result.itemId);
        setMessage(`${result.paymentMode === 'live' ? 'Payment' : 'Test payment'} verified. Your tournament entry is ready for the next matchmaking stage.`);
        const url = new URL(window.location.href);
        ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, '', url);
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Could not verify checkout.'));
  }, []);

  const backendLabel = useMemo(() => {
    if (!multiplayerConfigured) return 'Backend not connected';
    if (catalog.paymentConfigured && catalog.paymentMode === 'live') return 'Live payments ready';
    if (catalog.paymentConfigured && catalog.paymentMode === 'test') return 'Stripe test payments ready';
    return 'Realtime ready · payments off';
  }, [catalog.paymentConfigured, catalog.paymentMode]);

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
    onPlayOnline();
  };

  return (
    <div className="tournament-page-v14 qqurz-content-page">
      <section className="page-heading-v14">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">OFFICIAL QQURZ TOURNAMENTS</span>
        <h1>Hosted events, from 10 players to 100+.</h1>
        <p>QQURZ can publish different seat counts and formats while private friend rooms remain a separate play mode.</p>
        <div className="status-row-v14">
          <span className={multiplayerConfigured ? 'ok' : ''}>{backendLabel}</span>
          <span>Server-authoritative Chess960 rooms</span>
          <span>Skill competition · no odds · no side bets</span>
        </div>
      </section>

      <section className="tournament-list-v14">
        {catalog.tournaments.map(event => (
          <article key={event.id} className={verifiedItem === event.id ? 'verified' : ''}>
            <div className="tournament-card-top">
              <div>
                <span className="event-format">QQURZ HOSTED · {event.format} · {event.seats} seats</span>
                <h2>{event.name}</h2>
              </div>
              <strong>{money(event.entryCents)}</strong>
            </div>
            <div className="event-facts">
              <span>Capacity</span><b>{event.seats} players</b>
              <span>Entry fee</span><b>{money(event.entryCents)}</b>
              <span>Time control</span><b>{event.timeControl}</b>
              <span>Prize</span><b>{event.prizeLabel}</b>
            </div>
            {verifiedItem === event.id ? (
              <button className="primary-black" onClick={openVerifiedMatch}>✓ Payment verified · continue</button>
            ) : (
              <button
                className="primary-black"
                onClick={() => checkout(event.id)}
                disabled={!catalog.paymentConfigured || catalog.paymentMode === 'off' || Boolean(busyId)}
              >
                {busyId === event.id ? 'Opening secure checkout…' : `Enter · ${money(event.entryCents)}`}
              </button>
            )}
            <small className="test-disclaimer">
              {catalog.paymentMode === 'live'
                ? 'Live tournament charges remain server-controlled and may be disabled until an event is operationally approved.'
                : 'Tournament checkout is currently in Stripe test mode; no real entry fee is charged.'}
            </small>
          </article>
        ))}
      </section>

      <section className="premium-callout-v14">
        <div>
          <span className="qqurz-kicker">PREMIUM 3D</span>
          <h2>3D is a separate {money(catalog.premium3dPriceCents)} unlock.</h2>
          <p>The Three.js renderer is not downloaded for normal 2D players. A verified Premium purchase is required before the 3D board loads.</p>
        </div>
        <button onClick={onShow3D}>Unlock 3D · {money(catalog.premium3dPriceCents)}</button>
      </section>

      {!multiplayerConfigured && (
        <p className="setup-note-v14">Deploy the included Cloudflare Worker/Durable Object backend and set <code>VITE_MULTIPLAYER_API</code> to enable private rooms and payment verification.</p>
      )}
      {message && <div className="inline-message-v14" role="status">{message}</div>}
    </div>
  );
}
