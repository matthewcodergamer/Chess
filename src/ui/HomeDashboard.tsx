import { useEffect, useMemo, useRef, useState } from 'react';
import type { OnlinePlayer } from '../multiplayer/client';
import { PrimaryButton, SecondaryButton } from './controls';
import HomeBoardPreview from './HomeBoardPreview';

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
            <b>{profile.username}</b>
          </span>
        </button>
        <div className="home-online-wrap" ref={onlineWrapRef}>
          <button className="home-online-status" onClick={() => setOnlineListOpen(value => !value)} aria-label={`${onlineLabel}. Show online players.`} aria-expanded={onlineListOpen} aria-controls="home-online-player-list">
            <span className="presence-dot" aria-hidden="true" />
            <span className="home-online-copy"><b>{onlineLabel}</b><small>Chess960 players</small></span>
            <span className="home-online-chevron" aria-hidden="true">⌄</span>
          </button>
          {onlineListOpen && <div id="home-online-player-list" className="home-online-popover" role="region" aria-label="Online players">
            <div className="home-online-popover-head"><div><b>Online players</b><small>Players visible right now</small></div><span>{onlinePlayers.length}</span></div>
            {onlinePlayers.length ? <ul>{onlinePlayers.map(player => <li key={`${player.name}-${player.state}`}><span className={`presence-dot presence-dot--${player.state}`} /><span>{player.name}</span><small>{player.state === 'game' ? 'In a game' : player.state === 'away' ? 'Away' : 'Online'}</small></li>)}</ul> : <p>No other players are currently visible.</p>}
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
          <PrimaryButton size="lg" fullWidth leadingIcon="♞" onClick={onMatchmaking}>
            Find an opponent
          </PrimaryButton>
          <small>Chess960 · automatic 10+5 matchmaking</small>
        </div>

        <div className="home-secondary-play">
          <SecondaryButton size="md" fullWidth leadingIcon="♘" onClick={onFriend}>Play a friend</SecondaryButton>
          <SecondaryButton size="md" fullWidth leadingIcon="♟" onClick={onSameDevice}>Same device</SecondaryButton>
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
          <span className="home-activity-piece" aria-hidden="true">♛</span>
          <div><small>Compete</small><b>Tournament lobby</b><p>Browse fields, brackets and upcoming Chess960 events.</p></div>
          <SecondaryButton size="sm" onClick={onTournament}>Open tournaments</SecondaryButton>
        </article>
      </section>

      <section className="home-premium-row">
        <span className="home-premium-piece" aria-hidden="true">♜</span>
        <div><span className="chess-eyebrow">Premium 3D</span><b>Physical board mode</b><small>Play with the table-style board and clock.</small></div>
        <SecondaryButton size="sm" onClick={onPremium3D}>Open 3D</SecondaryButton>
      </section>

      <section className="home-ai-row" aria-label="AI practice">
        <span aria-hidden="true">♞</span>
        <div><b>Practice with AI</b><small>Stockfish training stays separate from competitive play.</small></div>
        <SecondaryButton size="sm" onClick={onAI}>Practice</SecondaryButton>
      </section>

      <footer className="qqurz-home-footer-v24">
        <span>♚ qqurzchess</span>
        <span>Competitive Chess960</span>
      </footer>
    </div>
  );
}