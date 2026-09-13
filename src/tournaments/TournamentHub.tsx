import { lazy, Suspense, useState } from 'react';
import TournamentMasterGrid from './TournamentMasterGrid';
import LegacyTournamentHub from './LegacyTournamentHub';
import { TournamentEngineSkeleton } from '../ui/Skeletons';

const TournamentEnginePanel = lazy(() => import('./TournamentEnginePanel'));

type Props = {
  onBack: () => void;
  onPlayOnline: () => void;
  onShow3D: () => void;
};

type TournamentSurface = 'engine' | 'catalog';

export default function TournamentHub(props: Props) {
  const [surface, setSurface] = useState<TournamentSurface>('engine');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (surface === 'catalog') {
    return (
      <div className="tournament-center-shell">
        <div className="tournament-center-switch" role="tablist" aria-label="Tournament mode">
          <button role="tab" aria-selected={false} onClick={() => setSurface('engine')}>Tournament engine</button>
          <button role="tab" aria-selected className="active" onClick={() => setSurface('catalog')}>Preset / test catalog</button>
        </div>
        <LegacyTournamentHub {...props} />
      </div>
    );
  }

  return (
    <div className="tournament-center-shell qqurz-content-page">
      <section className="tournament-engine-title">
        <button className="text-back" onClick={props.onBack}>← Home</button>
        <span className="qqurz-kicker">TOURNAMENTS</span>
        <h1>Find a tournament and get in.</h1>
        <p>The availability grid is built from real server tournament records. Capacity filters help you browse; registration, check-in, pairings, results and player status stay server-authoritative.</p>
      </section>
      <div className="tournament-center-switch" role="tablist" aria-label="Tournament mode">
        <button role="tab" aria-selected className="active" onClick={() => setSurface('engine')}>Live tournaments</button>
        <button role="tab" aria-selected={false} onClick={() => setSurface('catalog')}>Preset / test catalog</button>
      </div>

      <TournamentMasterGrid onOpenGame={props.onPlayOnline} />

      <details className="tournament-engine-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
        <summary>Event details, standings & organizer tools</summary>
        {advancedOpen && <Suspense fallback={<TournamentEngineSkeleton/>}><TournamentEnginePanel onOpenGame={props.onPlayOnline} /></Suspense>}
      </details>
    </div>
  );
}
