import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OnlinePlayer } from '../multiplayer/client';
import { PrimaryButton, SecondaryButton } from './controls';
import HomeBoardPreview from './HomeBoardPreview';

type HomeIconName = 'chevron' | 'pawn' | 'knight' | 'rook' | 'queen' | 'king';

function HomeIcon({ name }: { name: HomeIconName }) {
  const paths: Record<HomeIconName, ReactNode> = {
    chevron: <path d="m7 9 5 6 5-6" />,
    pawn: <><circle cx="12" cy="6.5" r="3" /><path d="M8.5 10h7l-1.5 5 3 4H7l3-4-1.5-5Z" /><path d="M6 21h12" /></>,
    knight: <path d="M7 20h11M8 20c.5-3 1.7-4.8 3.8-6.2 1.7-1 2.7-2.1 2.7-4.2 0-1.8-.9-3.2-2.5-4.1.1 1.3-.5 2.2-1.8 2.6-1.2.4-2.4.1-3.2-.8.1 2.1.9 3.5 2.4 4.4-2.2 1.3-3.4 3.6-3.4 6.3M15 5.7c1.8.3 3 1.5 3.3 3.4" />,
    rook: <><path d="M7 5v4M11 5v4M15 5v4M19 5v4M6 9h13l-1 3H7zM9 12l-1 6h8l-1-6M6 20h12" /></>,
    queen: <><path d="m6 7 2 5 4-6 4 6 2-5 1 10H5z" /><path d="M5 20h14" /></>,
    king: <><path d="M12 4v5M9.5 6.5h5M8 11h8l-1 5H9zM7 20h10M9 16l-1 4M15 16l1 4" /></>,
  };
  return <svg className="home-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

// The home route is intentionally a play-first chess dashboard, not a marketing hero.

type Props = {
  onlineLabel: string;
  onlinePlayers: OnlinePlayer[];
  onProfile: () => void;
  onTournament: () => void;
  onFriend: () => void;
  onSameDevice: () => void;
  onMatchmaking: () => void;
  onPremium3D: () => void;
  onAI: () => void;
};

type HomeProfile = {
  username?: string;
  avatar?: string;
};


function loadProfile(): Required<HomeProfile> {
  try {
    const raw = window.localStorage.getItem('qqurz:profile');
    const value = raw ? JSON.parse(raw) as HomeProfile : null;
    return {
      username: value?.username?.trim() || 'Guest',
      avatar: value?.avatar?.trim() || '♞',
    };
  } catch {
    return { username: 'Guest', avatar: '♞' };
  }
}


export default function HomeDashboard({
  onlineLabel,
  onlinePlayers,
  onProfile,
  onTournament,
  onFriend,
  onSameDevice,
  onMatchmaking,
  onPremium3D,
  onAI,
}: Props) {
  const profile = useMemo(loadProfile, []);
  const [onlineListOpen, setOnlineListOpen] = useState(false);
  const onlineWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onlineListOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !onlineWrapRef.current?.contains(target)) setOnlineListOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOnlineListOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onlineListOpen]);

  return (
    <div className="qqurz-home-v24 home-dashboard">
      <section className="home-player-status" aria-label="Your player status">
        <button className="home-player-identity" onClick={onProfile} aria-label={`Open ${profile.username} profile`}>
          <span className="home-player-avatar" aria-hidden="true">{profile.avatar}</span>
          <span>
            <small>Player</small>
            <span className="home-player-name">{profile.username}</span>
          </span>
        </button>
        <div className="home-online-wrap" ref={onlineWrapRef}>
          <button className="home-online-status" onClick={() => setOnlineListOpen(value => !value)} aria-label={`${onlineLabel}. Show online players.`} aria-expanded={onlineListOpen} aria-controls="home-online-player-list">
            <span className="presence-dot" aria-hidden="true" />
            <span className="home-online-copy"><b>{onlineLabel}</b><small>Chess960 players</small></span>
            <span className="home-online-chevron"><HomeIcon name="chevron" /></span>
          </button>
          {onlineListOpen && <div id="home-online-player-list" className="home-online-popover" role="region" aria-label="Online players">
            <div className="home-online-popover-head"><div><b>Online players</b><small>Players visible right now</small></div><span>{onlinePlayers.length || onlineLabel}</span></div>
            {onlinePlayers.length ? <ul>{onlinePlayers.map(player => <li key={`${player.name}-${player.state}`}><span className={`presence-dot presence-dot--${player.state}`} /><span>{player.name}</span><small>{player.state === 'game' ? 'In a game' : player.state === 'away' ? 'Away' : 'Online'}</small></li>)}</ul> : <p>{onlineLabel === 'Connecting…' ? 'Player details are loading…' : onlineLabel === '0 online' ? 'No other players are currently visible.' : `Online count is ${onlineLabel}; player details are still syncing.`}</p>}
            <button className="home-online-find" onClick={onMatchmaking}>Find an opponent</button>
          </div>}
        </div>
      </section>

      <section className="home-play-panel" aria-labelledby="home-play-heading">
        <div className="home-play-heading">
          <div>
            <span className="chess-eyebrow">Chess960</span>
            <h1 id="home-play-heading">Play chess.</h1>
          </div>
          <span className="home-variant-badge">960</span>
        </div>

        <div className="home-primary-play">
          <PrimaryButton size="lg" fullWidth leadingIcon={<HomeIcon name="knight" />} onClick={onMatchmaking}>
            Find an opponent
          </PrimaryButton>
          <small>Chess960 · automatic 10+5 matchmaking</small>
        </div>

        <div className="home-secondary-play">
          <SecondaryButton size="md" fullWidth leadingIcon={<HomeIcon name="knight" />} onClick={onFriend}>Play a friend</SecondaryButton>
          <SecondaryButton size="md" fullWidth leadingIcon={<HomeIcon name="pawn" />} onClick={onSameDevice}>Same device</SecondaryButton>
        </div>
      </section>

      <section className="home-board-area" aria-label="Chess960 board">
        <div className="home-section-heading">
          <div><span className="chess-eyebrow">Board</span><h2>Ready position</h2></div>
          <SecondaryButton size="sm" onClick={onMatchmaking}>Play anyone</SecondaryButton>
        </div>
        <HomeBoardPreview playerName={profile.username} />
      </section>

      <section className="home-activity-grid" aria-label="Chess activity">
        <article className="home-activity-card live">
          <span className="presence-dot" />
          <div><small>Live now</small><b>{onlineLabel}</b><p>Jump into random Chess960 matchmaking.</p></div>
          <SecondaryButton size="sm" onClick={onMatchmaking}>Find an opponent</SecondaryButton>
        </article>
        <article className="home-activity-card tournament">
          <span className="home-activity-piece" aria-hidden="true"><HomeIcon name="queen" /></span>
          <div><small>Compete</small><b>Tournament lobby</b><p>Browse fields, brackets and upcoming Chess960 events.</p></div>
          <SecondaryButton size="sm" onClick={onTournament}>Open tournaments</SecondaryButton>
        </article>
      </section>

      <section className="home-premium-row">
        <span className="home-premium-piece" aria-hidden="true"><HomeIcon name="rook" /></span>
        <div><span className="chess-eyebrow">Premium 3D</span><b>Physical board mode</b><small>Play with the table-style board and clock.</small></div>
        <SecondaryButton size="sm" onClick={onPremium3D}>Open 3D</SecondaryButton>
      </section>

      <section className="home-ai-row" aria-label="AI practice">
        <span aria-hidden="true"><HomeIcon name="knight" /></span>
        <div><b>Practice with AI</b><small>Stockfish training stays separate from competitive play.</small></div>
        <SecondaryButton size="sm" onClick={onAI}>Practice</SecondaryButton>
      </section>

      <footer className="qqurz-home-footer-v24">
        <span><HomeIcon name="king" /> qqurzchess</span>
        <span>Competitive Chess960</span>
      </footer>
    </div>
  );
}