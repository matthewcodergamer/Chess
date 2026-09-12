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
      <div><span className="eyebrow">PLAYER WALLET</span><h3>Money features are optional</h3><p>You can play free chess without financial identity verification. Sign in only when you want wallet or paid-competition features.</p></div>
    </section>
  );

  if (!wallet) return (
    <section className="wallet-balance-panel" aria-label="QQURZ wallet">
      <div><span className="eyebrow">PLAYER WALLET</span><h3>{loading ? 'Loading wallet…' : 'Wallet unavailable'}</h3>{message && <p>{message}</p>}<p>Free chess does not depend on the wallet or financial verification.</p></div>
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
        <div className="wallet-policy-note"><b>Money verification is separate from your chess account</b><span>{depositDecision.reason || 'Funding may require age, jurisdiction, identity, tax, or payment verification depending on the money feature and approved jurisdiction.'}</span><span>You can keep playing free chess without completing financial verification.</span></div>
      )}
      <small>Financial checks are requested only for money features that require them. Provider confirmations update this balance through the backend ledger; checkout redirects never credit money by themselves.</small>
      {message && <p className="wallet-message" role="status">{message}</p>}
    </section>
  );
}
