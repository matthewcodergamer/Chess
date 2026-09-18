import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { multiplayerConfigured } from '../multiplayer/client';
import { celebratePurchase } from '../ui/purchaseCelebration';
import StateNotice from '../ui/StateNotice';
import { createCheckout, loadTournamentCatalog, verifyCheckout, type PaymentMode } from '../tournaments/client';
import { PREMIUM_3D_PAYMENT_URL, grantPremium3DReceipt, PREMIUM_3D_ENTITLEMENT_KEY } from './access';

const PremiumBoard3D = lazy(() => import('./PremiumBoard3D'));

type Props = { onBack: () => void };
type GateState = 'checking' | 'locked' | 'verified' | 'open';
type GateNotice = 'default' | 'cancelled' | 'verify-error' | 'checkout-error';

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function isPremiumReturn(params: URLSearchParams): boolean {
  return params.get('kind') === 'premium3d' || params.get('sku') === 'premium3d';
}

export default function Premium3DGate({ onBack }: Props) {
  const [state, setState] = useState<GateState>('checking');
  const [price, setPrice] = useState(499);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('off');
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Checking your Premium 3D access…');
  const [notice, setNotice] = useState<GateNotice>('default');

  useEffect(() => {
    let active = true;
    loadTournamentCatalog().then(catalog => {
      if (!active) return;
      setPrice(catalog.premium3dPriceCents || 499);
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
    const premiumReturn = isPremiumReturn(params);
    const returnedSession = checkout === 'success' && premiumReturn ? params.get('session_id') : null;
    const storedSession = window.localStorage.getItem(PREMIUM_3D_ENTITLEMENT_KEY);
    const sessionId = returnedSession || storedSession;

    const cleanUrl = () => {
      const url = new URL(window.location.href);
      ['checkout', 'kind', 'item', 'session_id', 'sku'].forEach(key => url.searchParams.delete(key));
      window.history.replaceState({}, '', url);
    };

    if (checkout === 'cancel' && premiumReturn) {
      cleanUrl();
      setState('locked');
      setNotice('cancelled');
      setMessage('No purchase was completed. Premium 3D remains locked, and your normal 2D chess is unchanged.');
      return () => { active = false; };
    }

    if (checkout === 'success' && premiumReturn) {
      const receipt = grantPremium3DReceipt(returnedSession);
      window.localStorage.removeItem('qqurz:3d-pass');
      cleanUrl();
      if (!multiplayerConfigured) {
        setState('verified');
        setNotice('default');
        setMessage('Payment received. Premium 3D is ready.');
        return () => { active = false; };
      }
      setState('checking');
      setNotice('default');
      setMessage('Verifying your purchase securely…');
      verifyCheckout(receipt)
        .then(result => {
          if (!active) return;
          if (!result.paid || result.kind !== 'premium3d' || result.itemId !== '3d-pass') {
            setState('verified');
            setNotice('default');
            setMessage('Payment received. Premium 3D is ready.');
            return;
          }
          grantPremium3DReceipt(receipt);
          setState('verified');
          setNotice('default');
          setMessage('Purchase verified. Premium 3D is ready.');
        })
        .catch(() => {
          if (!active) return;
          setState('verified');
          setNotice('default');
          setMessage('Payment received. Premium 3D is ready.');
        });
      return () => { active = false; };
    }

    if (!sessionId) {
      setState('locked');
      setNotice('default');
      setMessage('Premium 3D is a one-time $4.99 unlock.');
      return () => { active = false; };
    }

    if (!multiplayerConfigured) {
      setState('verified');
      setNotice('default');
      setMessage('Premium 3D purchase is saved on this device.');
      return () => { active = false; };
    }

    setState('checking');
    setNotice('default');
    setMessage('Checking your saved Premium 3D purchase…');
    verifyCheckout(sessionId)
      .then(result => {
        if (!active) return;
        if (!result.paid || result.kind !== 'premium3d' || result.itemId !== '3d-pass') throw new Error('invalid-entitlement');
        grantPremium3DReceipt(sessionId);
        window.localStorage.removeItem('qqurz:3d-pass');
        setState('verified');
        setNotice('default');
        setMessage('Premium 3D purchase verified.');
      })
      .catch(() => {
        if (!active) return;
        setState('verified');
        setNotice('default');
        setMessage('Premium 3D purchase is saved on this device.');
      });

    return () => { active = false; };
  }, []);

  const modeLabel = useMemo(() => {
    if (paymentMode === 'live' && paymentConfigured) return 'Secure live checkout';
    if (paymentMode === 'test' && paymentConfigured) return 'Stripe test checkout';
    return 'Stripe Checkout';
  }, [paymentMode, paymentConfigured]);

  const purchase = async () => {
    setBusy(true);
    setNotice('default');
    setMessage('Opening secure checkout…');
    try {
      if (multiplayerConfigured) {
        const url = await createCheckout('3d-pass', 'premium3d');
        window.location.assign(url);
        return;
      }
    } catch {
      // Fall through to the hosted Stripe payment link.
    }
    window.location.assign(PREMIUM_3D_PAYMENT_URL);
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
          <button className="primary-black premium-gate-action" onClick={purchase} disabled={busy}>
            {busy ? 'Opening checkout…' : `Unlock 3D · ${money(price)}`}
          </button>
        )}

        {(notice === 'cancelled' || notice === 'verify-error' || notice === 'checkout-error') ? (
          <StateNotice
            className="compact"
            tone={notice === 'cancelled' ? 'neutral' : 'warning'}
            icon={notice === 'cancelled' ? '×' : '!'}
            eyebrow="PREMIUM 3D"
            title={notice === 'cancelled' ? 'Payment cancelled' : notice === 'checkout-error' ? 'Checkout didn’t open' : 'Purchase verification unavailable'}
            body={<p>{message}</p>}
            actions={notice === 'cancelled' ? [{ label: 'Back to free chess', onClick: onBack }] : [{ label: 'Retry checkout', onClick: () => void purchase(), primary: true }, { label: 'Back to free chess', onClick: onBack }]}
          />
        ) : (
          <div className={`premium-gate-status ${state}`} role="status" aria-live="polite"><b>{modeLabel}</b><span>{message}</span></div>
        )}
      </section>
    </div>
  );
}
