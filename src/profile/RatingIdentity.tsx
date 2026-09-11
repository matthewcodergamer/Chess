import type { Account, Chess960RatingClass, Chess960RatingState } from '../account/client';

const RATING_ORDER: readonly Chess960RatingClass[] = ['rapid', 'blitz', 'bullet'];
const RATING_META: Record<Chess960RatingClass, { label: string; piece: string; note: string }> = {
  rapid: { label: 'Rapid', piece: '♜', note: 'Longer calculation' },
  blitz: { label: 'Blitz', piece: '♞', note: 'Fast competitive play' },
  bullet: { label: 'Bullet', piece: '♟', note: 'Very fast play' },
};

function ratingLabel(state: Chess960RatingState): string {
  return state.provisional ? 'Provisional' : 'Established';
}

function recordLabel(state: Chess960RatingState): string {
  return `${state.wins}W · ${state.draws}D · ${state.losses}L`;
}

export default function RatingIdentity({ account }: { account: Account }) {
  const ratedGames = RATING_ORDER.reduce((total, key) => total + account.chess960Ratings[key].games, 0);

  return (
    <section className="player-rating-sheet" aria-label="Chess960 ratings">
      <header className="player-rating-heading">
        <div>
          <span className="qqurz-kicker">CHESS960 RATINGS</span>
          <h2>Competitive identity</h2>
          <p>Separate Glicko-2 ratings follow the pace of the game instead of sharing one generic score.</p>
        </div>
        <span className="player-rating-model">Glicko-2</span>
      </header>

      <div className="player-rating-list">
        {RATING_ORDER.map(key => {
          const state = account.chess960Ratings[key];
          const meta = RATING_META[key];
          return (
            <article className="player-rating-row" key={key}>
              <span className="player-rating-piece" aria-hidden="true">{meta.piece}</span>
              <div className="player-rating-name">
                <b>Chess960 {meta.label}</b>
                <small>{meta.note}</small>
              </div>
              <div className="player-rating-score">
                <strong>{Math.round(state.rating)}</strong>
                <span className={state.provisional ? 'provisional' : 'established'}>{ratingLabel(state)}</span>
              </div>
              <div className="player-rating-detail">
                <span>RD {Math.round(state.deviation)}</span>
                <span>{state.games} rated {state.games === 1 ? 'game' : 'games'}</span>
                <span>{recordLabel(state)}</span>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="player-rating-footer">
        <span><b>{ratedGames}</b> rated games</span>
        <span><b>{account.gamesPlayed}</b> completed online games</span>
        <span><b>{account.wins}-{account.losses}-{account.draws}</b> overall record</span>
        <span>Lower RD means the rating is more established.</span>
      </footer>
    </section>
  );
}
