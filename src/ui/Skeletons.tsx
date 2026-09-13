import type { ReactNode } from 'react';

function Block({ className = '' }: { className?: string }) {
  return <span className={`qqurz-skeleton-block ${className}`.trim()} aria-hidden="true" />;
}

function SkeletonStatus({ label, children }: { label: string; children: ReactNode }) {
  return <div className="qqurz-structural-skeleton" role="status" aria-live="polite" aria-label={label}>{children}</div>;
}

export function PlayerListSkeleton({ rows = 4 }: { rows?: number }) {
  return <SkeletonStatus label="Loading players"><div className="qqurz-skeleton-player-list">{Array.from({ length: rows }, (_, index) => <article className="social-player-row" key={index} aria-hidden="true"><Block className="qqurz-skeleton-avatar"/><div className="social-player-copy"><Block className="qqurz-skeleton-line w-40"/><Block className="qqurz-skeleton-line w-70"/><Block className="qqurz-skeleton-line w-55"/></div><div className="social-actions"><Block className="qqurz-skeleton-control"/><Block className="qqurz-skeleton-control short"/></div></article>)}</div></SkeletonStatus>;
}

export function HistoryListSkeleton({ rows = 5 }: { rows?: number }) {
  return <SkeletonStatus label="Loading game history"><div className="account-history-list">{Array.from({ length: rows }, (_, index) => <article key={index} aria-hidden="true"><Block className="qqurz-skeleton-result"/><div><Block className="qqurz-skeleton-line w-40"/><Block className="qqurz-skeleton-line w-85"/><Block className="qqurz-skeleton-line w-55"/></div><Block className="qqurz-skeleton-score"/></article>)}</div></SkeletonStatus>;
}

export function StandingsSkeleton({ rows = 6 }: { rows?: number }) {
  return <SkeletonStatus label="Loading standings"><div className="engine-table-scroll"><table className="qqurz-skeleton-table"><thead><tr><th>#</th><th>Player</th><th>Rating</th><th>Pts</th><th>W</th><th>D</th><th>L</th><th>Buchholz</th><th>SB</th></tr></thead><tbody>{Array.from({ length: rows }, (_, index) => <tr key={index} aria-hidden="true"><td><Block className="qqurz-skeleton-line w-30"/></td><td><Block className="qqurz-skeleton-line w-70"/></td><td><Block className="qqurz-skeleton-line w-55"/></td><td><Block className="qqurz-skeleton-line w-40"/></td><td><Block className="qqurz-skeleton-line w-30"/></td><td><Block className="qqurz-skeleton-line w-30"/></td><td><Block className="qqurz-skeleton-line w-30"/></td><td><Block className="qqurz-skeleton-line w-55"/></td><td><Block className="qqurz-skeleton-line w-55"/></td></tr>)}</tbody></table></div></SkeletonStatus>;
}

export function TournamentFactsSkeleton() {
  return <dl className="master-event-facts qqurz-skeleton-facts" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div key={index}><dt><Block className="qqurz-skeleton-line w-40"/></dt><dd><Block className="qqurz-skeleton-line w-70"/></dd></div>)}</dl>;
}

function TournamentCardSkeleton({ index }: { index: number }) {
  return <article className="master-event-card" aria-hidden="true" key={index}><div className="master-event-card-head"><Block className="qqurz-skeleton-pill"/><Block className="qqurz-skeleton-line w-30"/></div><Block className="qqurz-skeleton-title w-70"/><div className="master-seat-meter"><div><Block className="qqurz-skeleton-line w-30"/><Block className="qqurz-skeleton-line w-40"/></div><Block className="qqurz-skeleton-meter"/></div><TournamentFactsSkeleton/><div className="master-player-status"><Block className="qqurz-skeleton-line w-30"/><Block className="qqurz-skeleton-line w-40"/></div><Block className="qqurz-skeleton-button"/></article>;
}

export function TournamentGridSkeleton({ cards = 6 }: { cards?: number }) {
  return <SkeletonStatus label="Loading tournaments"><section className="tournament-master-grid"><header className="master-grid-head"><div><Block className="qqurz-skeleton-line w-20"/><Block className="qqurz-skeleton-title w-55"/><Block className="qqurz-skeleton-line w-85"/></div><Block className="qqurz-skeleton-pill"/></header><div className="master-capacity-filter" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <Block className="qqurz-skeleton-filter" key={index}/>)}</div><div className="master-event-cards">{Array.from({ length: cards }, (_, index) => <TournamentCardSkeleton index={index} key={index}/>)}</div></section></SkeletonStatus>;
}

export function TournamentEventListSkeleton({ rows = 4 }: { rows?: number }) {
  return <SkeletonStatus label="Loading tournament list"><div aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div className="qqurz-skeleton-event-list-row" key={index}><Block className="qqurz-skeleton-line w-40"/><Block className="qqurz-skeleton-line w-70"/><Block className="qqurz-skeleton-line w-85"/></div>)}</div></SkeletonStatus>;
}

export function TournamentDetailSkeleton() {
  return <SkeletonStatus label="Loading tournament field and standings"><div><header aria-hidden="true"><div><Block className="qqurz-skeleton-pill"/><Block className="qqurz-skeleton-title w-55"/><Block className="qqurz-skeleton-line w-70"/></div><Block className="qqurz-skeleton-control"/></header><div className="engine-meta-grid" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <div key={index}><Block className="qqurz-skeleton-line w-40"/><Block className="qqurz-skeleton-line w-70"/></div>)}</div><section className="engine-standings"><div className="engine-section-head" aria-hidden="true"><div><Block className="qqurz-skeleton-line w-30"/><Block className="qqurz-skeleton-line w-55"/></div><Block className="qqurz-skeleton-line w-30"/></div><StandingsSkeleton/></section></div></SkeletonStatus>;
}

export function TournamentEngineSkeleton() {
  return <SkeletonStatus label="Loading tournament engine"><div className="engine-event-layout"><aside className="engine-event-list"><TournamentEventListSkeleton/></aside><section className="engine-event-detail"><TournamentDetailSkeleton/></section></div></SkeletonStatus>;
}

export function ProfilePageSkeleton() {
  return <SkeletonStatus label="Loading player profile"><div className="account-page qqurz-content-page"><header className="account-header" aria-hidden="true"><Block className="qqurz-skeleton-control"/><div className="account-identity"><Block className="qqurz-skeleton-avatar large"/><div><Block className="qqurz-skeleton-line w-30"/><Block className="qqurz-skeleton-page-title w-55"/><Block className="qqurz-skeleton-line w-70"/></div></div><Block className="qqurz-skeleton-control"/></header><nav className="account-tabs" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <Block className="qqurz-skeleton-tab" key={index}/>)}</nav><div className="account-content-grid"><section className="account-panel" aria-hidden="true"><div className="account-panel-heading"><div><Block className="qqurz-skeleton-line w-30"/><Block className="qqurz-skeleton-title w-55"/></div></div><div className="qqurz-skeleton-rating-grid">{Array.from({ length: 3 }, (_, index) => <div key={index}><Block className="qqurz-skeleton-line w-40"/><Block className="qqurz-skeleton-title w-55"/><Block className="qqurz-skeleton-line w-70"/></div>)}</div></section><section className="account-panel account-profile-editor" aria-hidden="true"><div className="account-panel-heading"><div><Block className="qqurz-skeleton-line w-30"/><Block className="qqurz-skeleton-title w-55"/></div></div><div className="account-avatar-editor"><Block className="qqurz-skeleton-avatar large"/><Block className="qqurz-skeleton-control"/></div><div className="account-form-grid"><Block className="qqurz-skeleton-field"/><Block className="qqurz-skeleton-field"/></div><Block className="qqurz-skeleton-field"/><Block className="qqurz-skeleton-button"/></section><section className="account-panel" aria-hidden="true"><div className="account-panel-heading"><div><Block className="qqurz-skeleton-line w-30"/><Block className="qqurz-skeleton-title w-40"/></div></div><Block className="qqurz-skeleton-field"/><Block className="qqurz-skeleton-field"/><Block className="qqurz-skeleton-button short"/></section></div></div></SkeletonStatus>;
}

export function TournamentPageSkeleton() {
  return <SkeletonStatus label="Loading tournament center"><div className="tournament-center-shell qqurz-content-page"><section className="tournament-engine-title" aria-hidden="true"><Block className="qqurz-skeleton-line w-20"/><Block className="qqurz-skeleton-line w-20"/><Block className="qqurz-skeleton-page-title w-70"/><Block className="qqurz-skeleton-line w-85"/><Block className="qqurz-skeleton-line w-70"/></section><div className="tournament-center-switch" aria-hidden="true"><Block className="qqurz-skeleton-tab"/><Block className="qqurz-skeleton-tab"/></div><TournamentGridSkeleton/></div></SkeletonStatus>;
}
