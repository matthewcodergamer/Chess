import { lazy, Suspense, useEffect, useState } from 'react';
import TournamentMasterGrid from './TournamentMasterGrid';
import { TournamentEngineSkeleton } from '../ui/Skeletons';
import StateNotice from '../ui/StateNotice';
import { UiIcon } from '../ui/icons';

const TournamentEnginePanel = lazy(() => import('./TournamentEnginePanel'));

type Props = {
  onBack: () => void;
  onPlayOnline: () => void;
  onShow3D: () => void;
};

function tournamentPaymentCancelled(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('checkout') === 'cancel' && params.get('kind') === 'tournament';
}

export default function TournamentHub(props: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [paymentCancelled] = useState(tournamentPaymentCancelled);

  useEffect(() => {
    if (!paymentCancelled) return;
    const url = new URL(window.location.href);
    ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
  }, [paymentCancelled]);

  return (
    <div className="tournament-center-shell qqurz-content-page">
      <section className="tournament-engine-title">
        <button className="text-back" onClick={props.onBack}><UiIcon name="back" /> Home</button>
        <span className="qqurz-kicker">TOURNAMENTS</span>
        <h1>Find a tournament and get in.</h1>
        <p>The availability grid is built from real server tournament records. Registration, check-in, pairings, results and player status stay server-authoritative.</p>
      </section>

      {paymentCancelled && <StateNotice className="compact" tone="neutral" icon={<UiIcon name="close" />} eyebrow="TOURNAMENT PAYMENT" title="Payment cancelled" body={<p>No purchase was completed. QQURZ did not create a paid tournament entry from the cancelled checkout, so you can safely choose another event or leave this page.</p>} />}

      <TournamentMasterGrid onOpenGame={props.onPlayOnline} />

      <details className="tournament-engine-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
        <summary>Event details, standings & organizer tools</summary>
        {advancedOpen && <Suspense fallback={<TournamentEngineSkeleton/>}><TournamentEnginePanel onOpenGame={props.onPlayOnline} /></Suspense>}
      </details>
    </div>
  );
}
