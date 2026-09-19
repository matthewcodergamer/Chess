import { useEffect, useState } from 'react';
import { CATALOG, SUBSCRIPTION_IDS, THEME_IDS, money, type CatalogItemId } from '../../shared/catalog';
import { PrimaryButton, SecondaryButton } from '../ui/controls';
import BrandMark from '../ui/BrandMark';
import { createCheckout, loadTournamentCatalog, verifyCheckout } from '../tournaments/client';
import { multiplayerConfigured } from '../multiplayer/client';
import { PREMIUM_3D_PAYMENT_URL } from './access';
import {
  grantFromCheckout,
  hasBlitzAccess,
  hasBoardTheme,
  hasFreestyle,
  hasPremium3D,
  hasWarmPieces,
  humanMatchesRemaining,
  loadPieceTheme,
  savePieceTheme,
} from './entitlements';

type Props = { onBack: () => void; onOpen3D: () => void };

function isPaidReturn(kind: string | null): boolean {
  return kind === 'premium3d' || kind === 'subscription' || kind === 'theme' || kind === 'blitz';
}

export default function StorePage({ onBack, onOpen3D }: Props) {
  const [busy, setBusy] = useState<CatalogItemId | null>(null);
  const [message, setMessage] = useState('');
  const [subscribed, setSubscribed] = useState(hasFreestyle);
  const [remaining, setRemaining] = useState(humanMatchesRemaining);

  const refresh = () => {
    setSubscribed(hasFreestyle());
    setRemaining(humanMatchesRemaining());
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const kind = params.get('kind');
    const item = params.get('item');
    const sessionId = params.get('session_id');
    const clean = () => {
      const url = new URL(window.location.href);
      ['checkout', 'kind', 'item', 'session_id', 'sku'].forEach(key => url.searchParams.delete(key));
      window.history.replaceState({}, '', url);
    };
    if (checkout === 'cancel' && isPaidReturn(kind)) {
      clean();
      setMessage('No purchase was completed.');
      return;
    }
    if (checkout === 'success' && item) {
      grantFromCheckout(item, sessionId);
      if (item === 'pieces-warm') savePieceTheme('warm');
      clean();
      setMessage('Payment received. Your extras are unlocked on this device.');
      refresh();
      if (multiplayerConfigured && sessionId) {
        verifyCheckout(sessionId).then(result => {
          if (result.paid && result.itemId) grantFromCheckout(result.itemId, sessionId);
          refresh();
        }).catch(() => undefined);
      }
    }
  }, []);

  const buy = async (id: CatalogItemId) => {
    setBusy(id);
    setMessage('Opening secure checkout…');
    try {
      if (multiplayerConfigured) {
        await loadTournamentCatalog();
        const url = await createCheckout(id, CATALOG[id].kind);
        window.location.assign(url);
        return;
      }
    } catch {
      // Hosted Stripe Checkout is the fallback when the payment API is offline.
    }
    if (id === '3d-pass') {
      window.location.assign(PREMIUM_3D_PAYMENT_URL);
      return;
    }
    setBusy(null);
    setMessage('Connect the qqurzchess payment server to buy this extra.');
  };

  const ownedLabel = (id: CatalogItemId): string | null => {
    if (id === '3d-pass' && hasPremium3D()) return 'Owned';
    if (id === 'theme-green' && hasBoardTheme('tournament')) return 'Owned';
    if (id === 'theme-slate' && hasBoardTheme('slate')) return 'Owned';
    if (id === 'pieces-warm' && hasWarmPieces()) return 'Owned';
    if ((id === 'blitz-day' || id === 'blitz-month') && hasBlitzAccess()) return 'Active';
    if (SUBSCRIPTION_IDS.includes(id) && subscribed) return 'Active';
    return null;
  };

  return (
    <div className="store-page qqurz-content-page">
      <header className="store-head">
        <SecondaryButton size="sm" leadingIcon="←" onClick={onBack}>Home</SecondaryButton>
        <div className="store-brand">
          <BrandMark />
          <div>
            <span className="chess-eyebrow">Freestyle Chess</span>
            <h1>Plans and extras.</h1>
          </div>
        </div>
      </header>

      <p className="store-lead">
        Free play covers computer games, puzzles, and ten casual human matches a month on the 2D walnut board.
        Freestyle unlocks rated play, every time control, analysis, 3D, and custom boards.
      </p>

      <section className="store-free-card">
        <div>
          <b>Free tier</b>
          <p>Unlimited computer games. Casual human matches only. No rated, blitz, or bullet. Take-backs stay free.</p>
        </div>
        <span>{subscribed ? 'Unlimited' : `${Number.isFinite(remaining) ? remaining : 10} human matches left this month`}</span>
      </section>

      <section className="store-section">
        <div className="store-section-head">
          <h2>Freestyle subscription</h2>
          <small>Annual is twenty percent off — two months free.</small>
        </div>
        <div className="store-grid store-grid-subs">
          {SUBSCRIPTION_IDS.map(id => {
            const item = CATALOG[id];
            const owned = ownedLabel(id);
            return (
              <article key={id} className={id === 'sub-annual' ? 'store-card featured' : 'store-card'}>
                <small>{id === 'sub-annual' ? 'Best value' : item.recurring?.intervalCount === 1 ? 'Monthly' : item.name.replace('Freestyle ', '')}</small>
                <b>{money(item.cents)}</b>
                <p>{item.blurb}</p>
                {owned ? <span className="store-owned">{owned}</span> : (
                  <PrimaryButton size="md" fullWidth loading={busy === id} onClick={() => void buy(id)}>
                    {busy === id ? 'Opening…' : `Start · ${money(item.cents)}`}
                  </PrimaryButton>
                )}
              </article>
            );
          })}
        </div>
        <ul className="store-perks">
          <li>Unlimited human matches</li>
          <li>Rated play</li>
          <li>Blitz, bullet, and longer clocks</li>
          <li>Analysis board and opening explorer</li>
          <li>3D board skin and custom themes</li>
        </ul>
      </section>

      <section className="store-section">
        <div className="store-section-head">
          <h2>One-time purchases</h2>
          <small>Keep these even without a subscription.</small>
        </div>
        <div className="store-grid">
          {(['3d-pass', ...THEME_IDS] as CatalogItemId[]).map(id => {
            const item = CATALOG[id];
            const owned = ownedLabel(id);
            return (
              <article key={id} className="store-card">
                <small>{item.name}</small>
                <b>{money(item.cents)}</b>
                <p>{item.blurb}</p>
                {owned ? (
                  id === '3d-pass' ? <PrimaryButton size="md" fullWidth onClick={onOpen3D}>Open 3D</PrimaryButton> : <span className="store-owned">{owned}</span>
                ) : (
                  <SecondaryButton size="md" fullWidth loading={busy === id} onClick={() => void buy(id)}>
                    {busy === id ? 'Opening…' : `Buy · ${money(item.cents)}`}
                  </SecondaryButton>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="store-section">
        <div className="store-section-head">
          <h2>Standalone blitz</h2>
          <small>For free-tier players who only want fast games.</small>
        </div>
        <div className="store-grid">
          {(['blitz-day', 'blitz-month'] as CatalogItemId[]).map(id => {
            const item = CATALOG[id];
            const owned = ownedLabel(id);
            return (
              <article key={id} className="store-card">
                <small>{item.name}</small>
                <b>{money(item.cents)}</b>
                <p>{item.blurb}</p>
                {owned ? <span className="store-owned">{owned}</span> : (
                  <SecondaryButton size="md" fullWidth loading={busy === id} onClick={() => void buy(id)}>
                    {busy === id ? 'Opening…' : `Buy · ${money(item.cents)}`}
                  </SecondaryButton>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {hasWarmPieces() && loadPieceTheme() !== 'warm' && (
        <SecondaryButton onClick={() => { savePieceTheme('warm'); document.documentElement.dataset.pieceTheme = 'warm'; refresh(); }}>Use warm wood pieces</SecondaryButton>
      )}

      {message && <p className="store-message" role="status">{message}</p>}
    </div>
  );
}
