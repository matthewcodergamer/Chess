import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { multiplayerConfigured } from '../multiplayer/client';
import { celebratePurchase } from '../ui/purchaseCelebration';
import { createCheckout, loadTournamentCatalog, verifyCheckout, type PaymentMode } from '../tournaments/client';
import { PREMIUM_3D_ENTITLEMENT_KEY } from './access';

const PremiumBoard3D = lazy(() => import('./PremiumBoard3D'));

type Props = { onBack: () => void };
type GateState = 'checking' | 'locked' | 'verified' | 'open';

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function Premium3DGate({ onBack }: Props) {
  const [state, setState] = useState<GateState>('checking');
  const [price, setPrice] = useState(499);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('off');
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Checking your Premium 3D access…');

  useEffect(() => {
    let active = true;
    loadTournamentCatalog().then(catalog => {
      if (!active) return;
      setPrice(catalog.premium3dPriceCents);
      setPaymentMode(catalog.paymentMode);
      setPaymentConfigured(catalog.paymentConfigured);
    }).catch(() => {
      if (active) setPaymentConfigured(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const kind = params.get('kind');
    const returnedSession = checkout === 'success' && kind === 'premium3d' ? params.get('session_id') : null;
    const storedSession = window.localStorage.getItem(PREMIUM_3D_ENTITLEMENT_KEY);
    const sessionId = returnedSession || storedSession;

    const cleanUrl = () => {
      const url = new URL(window.location.href);
      ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key));
      window.history.replaceState({}, '', url);
    };

    if (checkout === 'cancel' && kind === 'premium3d') {
      cleanUrl();
      setState('locked');
      setMessage('Checkout was cancelled. Your normal 2D chess remains available.');
      return () => { active = false; };
    }

    if (!sessionId || !multiplayerConfigured) {
      setState('locked');
      setMessage(multiplayerConfigured ? 'Premium 3D is a one-time $4.99 unlock.' : 'Premium checkout is unavailable until the QQURZ payment backend is connected.');
      return () => { active = false; };
    }

    setState('checking');
    setMessage(returnedSession ? 'Verifying your purchase securely…' : 'Checking your saved Premium 3D purchase…');
    verifyCheckout(sessionId)
      .then(result => {
        if (!active) return;
        if (!result.paid || result.kind !== 'premium3d' || result.itemId !== '3d-pass') {
          throw new Error('This checkout does not include the Premium 3D pass.');
        }
        window.localStorage.setItem(PREMIUM_3D_ENTITLEMENT_KEY, sessionId);
        window.localStorage.removeItem('qqurz:3d-pass');
        if (returnedSession) cleanUrl();
        setState('verified');
        setMessage(returnedSession ? 'Purchase verified. Premium 3D is ready.' : 'Premium 3D purchase verified.');
      })
      .catch(error => {
        if (!active) return;
        window.localStorage.removeItem(PREMIUM_3D_ENTITLEMENT_KEY);
        if (returnedSession) cleanUrl();
        setState('locked');
        setMessage(error instanceof Error ? error.message : 'Could not verify Premium 3D access.');
      });

    return () => { active = false; };
  }, []);

  const modeLabel = useMemo(() => paymentMode === 'live' ? 'Secure live checkout' : paymentMode === 'test' ? 'Stripe test checkout' : 'Checkout unavailable', [paymentMode]);

  const purchase = async () => {
    setBusy(true);
    setMessage('Opening secure checkout…');
    try {
      const url = await createCheckout('3d-pass', 'premium3d');
      window.location.assign(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start checkout.');
      setBusy(false);
    }
  };

  const open3D = (event: React.MouseEvent<HTMLButtonElement>) => {
    celebratePurchase(event.currentTarget);
    setState('open');
  };

  if (state === 'open') {
    return (
      <Suspense fallback={<div className="qqurz-loading"><span className="qqurz-loading-knight">♟</span><span>Loading Premium 3D…</span></div>}>
        <PremiumBoard3D onBack={onBack} />
      </Suspense>
    );
  }

  return (
    <div className="premium-gate-page qqurz-content-page">
      <section className="premium-gate-card">
        <button className="text-back" onClick={onBack}>← Home</button>
        <div className="premium-gate-icon" aria-hidden="true">♟</div>
        <span className="qqurz-kicker">PREMIUM 3D · ONE-TIME UNLOCK</span>
        <h1>Play QQURZ in 3D.</h1>
        <p>Normal Chess960 stays fast and free in 2D. Premium 3D loads only after a verified purchase, so Three.js never slows down the standard board.</p>

        <div className="premium-gate-price">
          <strong>{money(price)}</strong>
          <span>one-time</span>
        </div>

        <div className="premium-gate-features">
          <span>✓ Warm 3D walnut board</span>
          <span>✓ Human vs Human + Stockfish AI</span>
          <span>✓ Farther camera + touch zoom/rotation</span>
          <span>✓ Purchase re-verified by the QQURZ backend</span>
        </div>

        {state === 'checking' ? (
          <button className="primary-black premium-gate-action" disabled>Checking purchase…</button>
        ) : state === 'verified' ? (
          <button className="primary-black premium-gate-action verified" onClick={open3D}>✓ Open Premium 3D</button>
        ) : (
          <button className="primary-black premium-gate-action" onClick={purchase} disabled={!paymentConfigured || busy}>
            {busy ? 'Opening checkout…' : `Unlock 3D · ${money(price)}`}
          </button>
        )}

        <div className={`premium-gate-status ${state}`} role="status" aria-live="polite">
          <b>{modeLabel}</b><span>{message}</span>
        </div>
      </section>
    </div>
  );
}
