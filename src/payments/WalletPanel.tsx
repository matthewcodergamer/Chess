import { useCallback, useEffect, useState } from 'react';
import { formatUsdCents } from '../../shared/money';
import { accountToken } from '../account/client';
import StateNotice from '../ui/StateNotice';
import { openWalletDeposit } from './actions';
import { loadWallet, type WalletEnvelope } from './client';

function checkoutWasCancelled(): boolean {
  const params = new URLSearchParams(window.location.search);
  const checkout = (params.get('checkout') ?? '').toLowerCase();
  const payment = (params.get('payment') ?? '').toLowerCase();
  return ['cancel', 'cancelled', 'canceled'].includes(checkout) || ['cancel', 'cancelled', 'canceled'].includes(payment);
}

export default function WalletPanel() {
  const [wallet, setWallet] = useState<WalletEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [paymentCancelled] = useState(checkoutWasCancelled);
  const signedIn = Boolean(accountToken());

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    try {
      setWallet(await loadWallet());
      setMessage('');
    } catch {
      setMessage('wallet-unavailable');
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!paymentCancelled) return;
    const url = new URL(window.location.href);
    ['checkout', 'payment', 'session_id'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
  }, [paymentCancelled]);

  const deposit = async (amountCents: number) => {
    if (!wallet?.capabilities.deposit.allowed) return;
    setLoading(true);
    setMessage('opening-payment');
    try {
      await openWalletDeposit(amountCents);
    } catch {
      setMessage('payment-provider-unavailable');
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
      {paymentCancelled && <StateNotice className="compact" tone="neutral" icon="×" eyebrow="PAYMENT" title="Payment cancelled" body={<p>No purchase was completed. QQURZ did not credit a deposit or entry from this cancelled checkout.</p>} />}
      {loading ? (
        <div><span className="eyebrow">PLAYER WALLET</span><h3>Loading wallet…</h3><p>Checking your server-confirmed balance.</p></div>
      ) : (
        <StateNotice
          className="compact"
          tone="warning"
          icon="↻"
          eyebrow="PLAYER WALLET"
          title="Wallet couldn’t refresh"
          body={<p>The wallet service did not answer. Free chess still works, and this failed refresh did not change your balance.</p>}
          detail="If the service is temporarily unavailable, retrying after a moment is safe."
          actions={[{ label: 'Retry wallet', onClick: () => void refresh(), primary: true }]}
        />
      )}
    </section>
  );

  const depositDecision = wallet.capabilities.deposit;
  return (
    <section className="wallet-balance-panel" aria-label="QQURZ wallet">
      {paymentCancelled && <StateNotice className="compact" tone="neutral" icon="×" eyebrow="PAYMENT" title="Payment cancelled" body={<p>No purchase was completed. Your server-confirmed wallet balance below is unchanged by the cancelled checkout.</p>} />}
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
      {message === 'opening-payment' && <p className="wallet-message" role="status">Opening the secure payment provider…</p>}
      {message === 'payment-provider-unavailable' && <StateNotice className="compact" tone="warning" icon="!" title="Payment provider didn’t open" body={<p>No deposit was started. You can retry when you’re ready; free chess and your current wallet balance are unaffected.</p>} actions={[{ label: 'Refresh wallet', onClick: () => void refresh() }]} />}
    </section>
  );
}
