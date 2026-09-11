import { useCallback, useEffect, useState } from 'react';
import { formatUsdCents } from '../../shared/money';
import { accountToken } from '../account/client';
import { openWalletDeposit } from './actions';
import { loadWallet, type WalletEnvelope } from './client';

export default function WalletPanel() {
  const [wallet, setWallet] = useState<WalletEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const signedIn = Boolean(accountToken());

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    try {
      setWallet(await loadWallet());
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Wallet unavailable.');
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => { void refresh(); }, [refresh]);

  const deposit = async (amountCents: number) => {
    if (!wallet?.capabilities.deposit.allowed) return;
    setLoading(true);
    setMessage('Opening secure deposit…');
    try {
      await openWalletDeposit(amountCents);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open the payment provider.');
      setLoading(false);
    }
  };

  if (!signedIn) return (
    <section className="wallet-balance-panel" aria-label="QQURZ wallet">
      <div><span className="eyebrow">PLAYER WALLET</span><h3>Sign in to use real-money features</h3><p>Balances and competition eligibility are stored on the payment server, not in this browser.</p></div>
    </section>
  );

  if (!wallet) return (
    <section className="wallet-balance-panel" aria-label="QQURZ wallet">
      <div><span className="eyebrow">PLAYER WALLET</span><h3>{loading ? 'Loading wallet…' : 'Wallet unavailable'}</h3>{message && <p>{message}</p>}</div>
      {!loading && <button onClick={() => void refresh()}>Try again</button>}
    </section>
  );

  const depositDecision = wallet.capabilities.deposit;
  return (
    <section className="wallet-balance-panel" aria-label="QQURZ wallet">
      <div className="wallet-balance-heading">
        <div><span className="eyebrow">PLAYER WALLET</span><h3>{formatUsdCents(wallet.wallet.availableCents)}</h3><p>Available balance</p></div>
        <button onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </div>
      <div className="wallet-balance-breakdown">
        <div><span>Available</span><b>{formatUsdCents(wallet.wallet.availableCents)}</b></div>
        <div><span>In play</span><b>{formatUsdCents(wallet.wallet.heldCents)}</b></div>
        <div><span>Pending withdrawal</span><b>{formatUsdCents(wallet.wallet.pendingWithdrawalCents)}</b></div>
      </div>
      {depositDecision.allowed ? (
        <div className="wallet-deposit-row" aria-label="Add money">
          {[500, 1000, 2500, 5000].map(amount => <button key={amount} onClick={() => void deposit(amount)} disabled={loading}>Add {formatUsdCents(amount)}</button>)}
        </div>
      ) : (
        <div className="wallet-policy-note"><b>Real-money funding unavailable</b><span>{depositDecision.reason || 'Your jurisdiction or verification status is not approved.'}</span></div>
      )}
      <small>Provider confirmations update this balance through the backend ledger. Checkout redirects never credit money by themselves.</small>
      {message && <p className="wallet-message" role="status">{message}</p>}
    </section>
  );
}
