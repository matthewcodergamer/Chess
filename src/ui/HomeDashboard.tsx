import { useEffect, useMemo, useState } from 'react';
import { PrimaryButton, SecondaryButton, SegmentedControl } from './controls';
import HomeBoardPreview from './HomeBoardPreview';

type QuickTime = '3+2' | '5+0' | '10+0';

type Props = {
  onlineLabel: string;
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

const QUICK_TIME_KEY = 'qqurz:quick-time';
const QUICK_TIMES = [
  { value: '3+2', label: '3 + 2', ariaLabel: '3 minutes plus 2 second increment' },
  { value: '5+0', label: '5 min', ariaLabel: '5 minute game' },
  { value: '10+0', label: '10 min', ariaLabel: '10 minute game' },
] as const;

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

function loadQuickTime(): QuickTime {
  const saved = window.localStorage.getItem(QUICK_TIME_KEY);
  return saved === '3+2' || saved === '5+0' || saved === '10+0' ? saved : '10+0';
}

export default function HomeDashboard({
  onlineLabel,
  onProfile,
  onTournament,
  onFriend,
  onSameDevice,
  onMatchmaking,
  onPremium3D,
  onAI,
}: Props) {
  const profile = useMemo(loadProfile, []);
  const [quickTime, setQuickTime] = useState<QuickTime>(loadQuickTime);

  useEffect(() => {
    window.localStorage.setItem(QUICK_TIME_KEY, quickTime);
  }, [quickTime]);

  return (
    <div className="qqurz-home-v24 home-dashboard">
      <section className="home-player-status" aria-label="Your QQURZ player status">
        <button className="home-player-identity" onClick={onProfile} aria-label={`Open ${profile.username} profile`}>
          <span className="home-player-avatar" aria-hidden="true">{profile.avatar}</span>
          <span>
            <small>PLAYER</small>
            <b>{profile.username}</b>
          </span>
        </button>
        <button className="home-online-status" onClick={onMatchmaking} aria-label={`${onlineLabel}. Find an opponent.`}>
          <span className="presence-dot" />
          <span><b>{onlineLabel}</b><small>Chess960 players</small></span>
        </button>
      </section>

      <section className="home-play-panel" aria-labelledby="home-play-heading">
        <div className="home-play-heading">
          <div>
            <span className="chess-eyebrow">CHESS960</span>
            <h1 id="home-play-heading">Play chess.</h1>
          </div>
          <span className="home-variant-badge">960</span>
        </div>

        <div className="home-time-control">
          <div>
            <b>Time control</b>
            <small>Quick preference</small>
          </div>
          <SegmentedControl
            value={quickTime}
            options={QUICK_TIMES}
            onChange={setQuickTime}
            ariaLabel="Preferred Chess960 time control"
            size="sm"
            className="home-time-segments"
          />
        </div>

        <div className="home-primary-play">
          <PrimaryButton size="lg" fullWidth leadingIcon="♛" onClick={onTournament}>
            Play Tournament
          </PrimaryButton>
          <small>Competitive Chess960 · preferred {quickTime.replace('+0', ' min')}</small>
        </div>

        <div className="home-secondary-play">
          <SecondaryButton size="md" fullWidth leadingIcon="♘" onClick={onFriend}>Play a Friend</SecondaryButton>
          <SecondaryButton size="md" fullWidth leadingIcon="♟" onClick={onSameDevice}>Same Device</SecondaryButton>
        </div>
      </section>

      <section className="home-board-area" aria-label="Chess960 board">
        <div className="home-section-heading">
          <div><span className="chess-eyebrow">BOARD</span><h2>Ready position</h2></div>
          <SecondaryButton size="sm" onClick={onMatchmaking}>Play Anyone</SecondaryButton>
        </div>
        <HomeBoardPreview playerName={profile.username} />
      </section>

      <section className="home-activity-grid" aria-label="QQURZ activity">
        <article className="home-activity-card live">
          <span className="presence-dot" />
          <div><small>LIVE NOW</small><b>{onlineLabel}</b><p>Jump into random Chess960 matchmaking.</p></div>
          <SecondaryButton size="sm" onClick={onMatchmaking}>Find opponent</SecondaryButton>
        </article>
        <article className="home-activity-card tournament">
          <span className="home-activity-piece" aria-hidden="true">♛</span>
          <div><small>COMPETE</small><b>Tournament lobby</b><p>Browse fields, brackets and upcoming QQURZ events.</p></div>
          <SecondaryButton size="sm" onClick={onTournament}>Open tournaments</SecondaryButton>
        </article>
      </section>

      <section className="home-premium-row">
        <span className="home-premium-piece" aria-hidden="true">♜</span>
        <div><span className="chess-eyebrow">PREMIUM 3D</span><b>Physical board mode</b><small>Play with the table-style board and clock.</small></div>
        <SecondaryButton size="sm" onClick={onPremium3D}>Open 3D</SecondaryButton>
      </section>

      <section className="home-ai-row" aria-label="AI practice">
        <span aria-hidden="true">♞</span>
        <div><b>Practice with AI</b><small>Stockfish training stays separate from competitive play.</small></div>
        <SecondaryButton size="sm" onClick={onAI}>Practice</SecondaryButton>
      </section>

      <footer className="qqurz-home-footer-v24">
        <span>♚ QQURZ Chess</span>
        <span>Competitive Chess960</span>
      </footer>
    </div>
  );
}
