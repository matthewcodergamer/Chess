import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { multiplayerConfigured } from '../multiplayer/client';
import RecoveryState from '../ui/RecoveryState';
import { checkoutIssue } from '../ui/recoveryMessages';
import { celebratePurchase } from '../ui/purchaseCelebration';
import { createCheckout, loadTournamentCatalog, verifyCheckout, type PaymentMode } from '../tournaments/client';
import { PREMIUM_3D_ENTITLEMENT_KEY } from './access';

const PremiumBoard3D = lazy(() => import('./PremiumBoard3D'));

type Props = { onBack: () => void };
type GateState = 'checking' | 'locked' | 'verified' | 'open';
type GateIssue = 'cancelled' | 'verify' | 'checkout' | 'server' | null;

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
  const [issue, setIssue] = useState<GateIssue>(null);

  useEffect(() => {
    let active = true;
    loadTournamentCatalog().then(catalog => {
      if (!active) return;
      setPrice(catalog.premium3dPriceCents);
      setPaymentMode(catalog.paymentMode);
      setPaymentConfigured(catalog.paymentConfigured);
      setIssue(current => current === 'server' ? null : current);
    }).catch(() => {
      if (!active) return;
      setPaymentConfigured(false);
      setIssue('server');
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
      setIssue('cancelled');
      setMessage('Premium 3D remains locked.');
      return () => { active = false; };
    }

    if (!sessionId || !multiplayerConfigured) {
      setState('locked');
      setMessage(multiplayerConfigured ? 'Premium 3D is a one-time unlock.' : 'Premium checkout needs the QQURZ payment backend.');
      if (!multiplayerConfigured) setIssue('server');
      return () => { active = false; };
    }

    setState('checking');
    setMessage(returnedSession ? 'Verifying your purchase securely…' : 'Checking your saved Premium 3D purchase…');
    verifyCheckout(sessionId)
      .then(result => {
        if (!active) return;
        if (!result.paid || result.kind !== 'premium3d' || result.itemId !== '3d-pass') {
          throw new Error('Premium 3D entitlement was not confirmed.');
        }
        window.localStorage.setItem(PREMIUM_3D_ENTITLEMENT_KEY, sessionId);
        window.localStorage.removeItem('qqurz:3d-pass');
        if (returnedSession) cleanUrl();
        setIssue(null);
        setState('verified');
        setMessage(returnedSession ? 'Purchase verified. Premium 3D is ready.' : 'Premium 3D purchase verified.');
      })
      .catch(() => {
        if (!active) return;
        window.localStorage.removeItem(PREMIUM_3D_ENTITLEMENT_KEY);
        if (returnedSession) cleanUrl();
        setState('locked');
        setIssue('verify');
        setMessage('Premium 3D has not been unlocked.');
      });

    return () => { active = false; };
  }, []);

  const modeLabel = useMemo(() => paymentMode === 'live' ? 'Secure live checkout' : paymentMode === 'test' ? 'Stripe test checkout' : 'Checkout unavailable', [paymentMode]);

  const purchase = async () => {
    setBusy(true);
    setIssue(null);
    setMessage('Opening secure checkout…');
    try {
      const url = await createCheckout('3d-pass', 'premium3d');
      window.location.assign(url);
    } catch (error) {
      const friendly = checkoutIssue(error);
      setIssue('checkout');
      setMessage(friendly.body);
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

  const issueView = issue === 'cancelled' ? (
    <RecoveryState
      compact
      tone="warning"
      eyebrow="CHECKOUT"
      title="Checkout cancelled"
      body="No QQURZ purchase was completed. Premium 3D remains locked, and your normal 2D chess is unchanged."
      primaryAction={paymentConfigured ? { label: `Try again · ${money(price)}`, onClick: () => void purchase() } : undefined}
      secondaryAction={{ label: 'Keep playing 2D', onClick: onBack }}
    />
  ) : issue === 'verify' ? (
    <RecoveryState
      compact
      tone="warning"
      eyebrow="PURCHASE CHECK"
      title="We could not verify Premium 3D"
      body="QQURZ did not unlock the pass because the payment confirmation was not verified. If you completed checkout, retry after your connection is stable."
      primaryAction={{ label: 'Retry verification', onClick: () => window.location.reload() }}
      secondaryAction={{ label: 'Keep playing 2D', onClick: onBack }}
    />
  ) : issue === 'server' ? (
    <RecoveryState
      compact
      tone="offline"
      eyebrow="QQURZ SERVER"
      title="Checkout server unavailable"
      body="Premium 3D checkout cannot be verified right now. No QQURZ purchase has been completed on this screen."
      primaryAction={{ label: 'Retry connection', onClick: () => window.location.reload() }}
      secondaryAction={{ label: 'Keep playing 2D', onClick: onBack }}
    />
  ) : issue === 'checkout' ? (
    <RecoveryState
      compact
      tone="error"
      eyebrow="CHECKOUT"
      title="Checkout did not open"
      body={message}
      primaryAction={{ label: 'Try again', onClick: () => void purchase() }}
      secondaryAction={{ label: 'Keep playing 2D', onClick: onBack }}
    />
  ) : null;

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
        ) : !issueView ? (
          <button className="primary-black premium-gate-action" onClick={purchase} disabled={!paymentConfigured || busy}>
            {busy ? 'Opening checkout…' : `Unlock 3D · ${money(price)}`}
          </button>
        ) : null}

        {issueView ?? <div className={`premium-gate-status ${state}`} role="status" aria-live="polite"><b>{modeLabel}</b><span>{message}</span></div>}
      </section>
    </div>
  );
}
