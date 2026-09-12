import { useCallback, useEffect, useState } from 'react';
import { accountToken } from '../account/client';
import { acceptFairPlayPolicy, loadFairPlayPolicy, type FairPlayPolicy } from './client';

type Props = {
  onAccepted?: () => void;
  mode?: 'blocking' | 'inline';
};

export default function FairPlayPrompt({ onAccepted, mode = 'blocking' }: Props) {
  const [policy, setPolicy] = useState<FairPlayPolicy | null>(null);
  const [loading, setLoading] = useState(Boolean(accountToken()));
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!accountToken()) { setLoading(false); return; }
    setLoading(true);
    try {
      setPolicy(await loadFairPlayPolicy());
      setError('');
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Fair-play policy is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const accept = async () => {
    setAccepting(true);
    setError('');
    try {
      await acceptFairPlayPolicy();
      await refresh();
      onAccepted?.();
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Could not record fair-play acceptance.');
    } finally {
      setAccepting(false);
    }
  };

  if (!accountToken()) {
    if (mode === 'inline') return <div className="fair-play-inline-note">Sign in before entering rated or tournament competition.</div>;
    return null;
  }
  if (loading && !policy) return mode === 'inline' ? <div className="fair-play-inline-note">Checking fair-play status…</div> : null;
  if (policy?.accepted) return null;

  const card = (
    <section className="fair-play-policy-card" aria-label="Competitive fair-play agreement">
      <div className="fair-play-policy-head">
        <span className="eyebrow">FAIR PLAY</span>
        <h2>One agreement before your first competitive game.</h2>
        <p>Free practice stays open. Competitive matchmaking and tournaments use these rules.</p>
      </div>
      <ol className="fair-play-rules">
        {(policy?.rules ?? []).map(rule => <li key={rule}>{rule}</li>)}
      </ol>
      {!policy?.configured && <p className="fair-play-warning">Competitive review service is not configured on this server yet.</p>}
      {error && <p className="fair-play-error" role="alert">{error}</p>}
      <div className="fair-play-policy-actions">
        <button className="qqurz-primary-button" onClick={() => void accept()} disabled={accepting || !policy?.configured}>
          {accepting ? 'Recording…' : 'I agree — play fair'}
        </button>
        <small>Acceptance is stored with policy version {policy?.version ?? 'current'} and can be requested again if the rules materially change.</small>
      </div>
    </section>
  );

  if (mode === 'inline') return card;
  return <div className="fair-play-modal-backdrop"><div className="fair-play-modal-shell">{card}</div></div>;
}
