import { useState } from 'react';
import TournamentEnginePanel from './TournamentEnginePanel';
import LegacyTournamentHub from './LegacyTournamentHub';

type Props = {
  onBack: () => void;
  onPlayOnline: () => void;
  onShow3D: () => void;
};

type TournamentSurface = 'engine' | 'catalog';

export default function TournamentHub(props: Props) {
  const [surface, setSurface] = useState<TournamentSurface>('engine');

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
        <h1>Run the event, not just the bracket.</h1>
        <p>QQURZ now owns registration, check-in, seeding, pairings, game launch, verified results, standings and completion as one server-authoritative tournament lifecycle.</p>
      </section>
      <div className="tournament-center-switch" role="tablist" aria-label="Tournament mode">
        <button role="tab" aria-selected className="active" onClick={() => setSurface('engine')}>Tournament engine</button>
        <button role="tab" aria-selected={false} onClick={() => setSurface('catalog')}>Preset / test catalog</button>
      </div>
      <TournamentEnginePanel onOpenGame={props.onPlayOnline} />
    </div>
  );
}
