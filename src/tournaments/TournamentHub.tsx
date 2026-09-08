import { useEffect, useMemo, useState } from 'react';
import { multiplayerConfigured } from '../multiplayer/client';
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
    if (!sessionId || params.get('checkout') !== 'success') return;
    setMessage('Verifying test checkout…');
    verifyCheckout(sessionId)
      .then(result => {
        if (!result.paid) throw new Error('Payment has not completed yet.');
        setVerifiedItem(result.itemId);
        setMessage('Test payment verified. Your prototype entry is ready on this device.');
        if (result.kind === 'premium3d') window.localStorage.setItem('qqurz:3d-pass', 'test-unlocked');
        const url = new URL(window.location.href);
        url.searchParams.delete('checkout');
        url.searchParams.delete('session_id');
        window.history.replaceState({}, '', url);
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Could not verify checkout.'));
  }, []);

  const backendLabel = useMemo(() => {
    if (!multiplayerConfigured) return 'Backend not connected';
    if (catalog.paymentConfigured && catalog.paymentMode === 'test') return 'Test payments ready';
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

  return (
    <div className="tournament-page-v14 qqurz-content-page">
      <section className="page-heading-v14">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">TOURNAMENT LAB</span>
        <h1>Test the tournament experience.</h1>
        <p>Prototype entry fees, prize presentation and private online matches before the public launch.</p>
        <div className="status-row-v14">
          <span className={multiplayerConfigured ? 'ok' : ''}>{backendLabel}</span>
          <span>Skill competition · no odds · no side bets</span>
        </div>
      </section>

      <section className="tournament-list-v14">
        {catalog.tournaments.map(event => (
          <article key={event.id} className={verifiedItem === event.id ? 'verified' : ''}>
            <div className="tournament-card-top">
              <div>
                <span className="event-format">{event.format} · {event.seats} seats</span>
                <h2>{event.name}</h2>
              </div>
              <strong>{money(event.entryCents)}</strong>
            </div>
            <div className="event-facts">
              <span>Entry fee</span><b>{money(event.entryCents)}</b>
              <span>Time control</span><b>{event.timeControl}</b>
              <span>Prize</span><b>{event.prizeLabel}</b>
            </div>
            {verifiedItem === event.id ? (
              <button className="primary-black" onClick={onPlayOnline}>Payment verified · open test match</button>
            ) : (
              <button
                className="primary-black"
                onClick={() => checkout(event.id)}
                disabled={!catalog.paymentConfigured || catalog.paymentMode !== 'test' || Boolean(busyId)}
              >
                {busyId === event.id ? 'Opening secure test checkout…' : `Enter · ${money(event.entryCents)}`}
              </button>
            )}
            <small className="test-disclaimer">Test-mode tournament prototype. Public/live entry collection stays backend-controlled.</small>
          </article>
        ))}
      </section>

      <section className="premium-callout-v14">
        <div>
          <span className="qqurz-kicker">PREMIUM BOARD</span>
          <h2>3D is optional, never part of the fast 2D bundle.</h2>
          <p>The low-poly renderer is downloaded only when someone opens the 3D page.</p>
        </div>
        <button onClick={onShow3D}>Preview 3D</button>
      </section>

      {!multiplayerConfigured && (
        <p className="setup-note-v14">To test this with your father on separate internet connections, deploy the included Cloudflare Worker/Durable Object backend and set <code>VITE_MULTIPLAYER_API</code> in GitHub Actions.</p>
      )}
      {message && <div className="inline-message-v14">{message}</div>}
    </div>
  );
}
