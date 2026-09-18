import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { OnlinePlayer } from '../multiplayer/client';
import { SecondaryButton } from './controls';
import { AppIcon, AppIconPad, type AppIconName } from './AppIcons';
const HomeBoardPreview = lazy(() => import('./HomeBoardPreview'));

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

function avatarIcon(value: string): AppIconName | null {
  if (value === '♟') return 'pawn';
  if (value === '♞' || value === '♘') return 'knight';
  if (value === '♜' || value === '♖') return 'rook';
  if (value === '♛' || value === '♕') return 'queen';
  if (value === '♚' || value === '♔') return 'king';
  return null;
}

function ProfileAvatar({ value }: { value: string }) {
  const icon = avatarIcon(value);
  return icon ? <AppIcon name={icon} /> : <span>{value}</span>;
}

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
          <span className="home-player-avatar" aria-hidden="true"><ProfileAvatar value={profile.avatar} /></span>
          <span>
            <small>Player</small>
            <span className="home-player-name">{profile.username}</span>
          </span>
        </button>
        <div className="home-online-wrap" ref={onlineWrapRef}>
          <button className="home-online-status" onClick={() => setOnlineListOpen(value => !value)} aria-label={`${onlineLabel}. Show online players.`} aria-expanded={onlineListOpen} aria-controls="home-online-player-list">
            <span className="presence-dot" aria-hidden="true" />
            <span className="home-online-copy"><b>{onlineLabel}</b><small>Chess960 players</small></span>
            <span className="home-online-chevron"><AppIcon name="chevron" /></span>
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
            <span className="chess-eyebrow">Play now</span>
            <h1 id="home-play-heading">Play chess.</h1>
          </div>
          <span className="home-variant-badge">960</span>
        </div>
        <p className="home-play-lead">Pick how you want to play. The board takes over from there.</p>

        <div className="home-play-modes">
          <button type="button" className="home-play-mode home-play-mode--primary" onClick={onMatchmaking} aria-label="Play Online">
            <AppIconPad name="swords" tone="action" />
            <span><b>Play Online</b><small>Find an opponent right now</small></span>
          </button>
          <button type="button" className="home-play-mode" onClick={onFriend} aria-label="Play a friend">
            <AppIconPad name="users" />
            <span><b>Play a friend</b><small>Private room · share a code</small></span>
          </button>
          <button type="button" className="home-play-mode" onClick={onAI} aria-label="Play computer">
            <AppIconPad name="cpu" />
            <span><b>Play computer</b><small>Stockfish on this device</small></span>
          </button>
          <button type="button" className="home-play-mode" onClick={onSameDevice} aria-label="Same device">
            <AppIconPad name="board" />
            <span><b>Same device</b><small>Two players, one screen</small></span>
          </button>
        </div>
      </section>

      <section className="home-board-area" aria-label="Chess960 board">
        <div className="home-section-heading">
          <div><span className="chess-eyebrow">Board</span><h2>Ready position</h2></div>
          <SecondaryButton size="sm" onClick={onMatchmaking}>Play anyone</SecondaryButton>
        </div>
        <Suspense fallback={<div className="home-live-board-shell" aria-label="Chess960 board preview loading" />}>
          <HomeBoardPreview playerName={profile.username} />
        </Suspense>
      </section>

      <section className="home-activity-grid" aria-label="Chess activity">
        <article className="home-activity-card live">
          <AppIconPad name="swords" />
          <div><small>Live now</small><b>{onlineLabel}</b><p>Jump into random Chess960 matchmaking.</p></div>
          <SecondaryButton size="sm" onClick={onMatchmaking}>Find an opponent</SecondaryButton>
        </article>
        <article className="home-activity-card tournament">
          <AppIconPad name="trophy" />
          <div><small>Compete</small><b>Tournament lobby</b><p>Browse fields, brackets and upcoming Chess960 events.</p></div>
          <SecondaryButton size="sm" onClick={onTournament}>Open tournaments</SecondaryButton>
        </article>
      </section>

      <section className="home-premium-row">
        <AppIconPad name="cube" tone="action" />
        <div><span className="chess-eyebrow">Premium 3D</span><b>Physical board mode</b><small>Play with the table-style board and clock.</small></div>
        <SecondaryButton size="sm" onClick={onPremium3D}>Open 3D</SecondaryButton>
      </section>

      <section className="home-ai-row" aria-label="AI practice">
        <AppIconPad name="knight" tone="muted" />
        <div><b>Practice with AI</b><small>Stockfish training stays separate from competitive play.</small></div>
        <SecondaryButton size="sm" onClick={onAI}>Practice</SecondaryButton>
      </section>

      <footer className="qqurz-home-footer-v24">
        <span><AppIcon name="king" /> qqurzchess</span>
        <span>© 2026 qqurzchess. All rights reserved.</span>
      </footer>
    </div>
  );
}
