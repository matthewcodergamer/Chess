import { lazy, Suspense, useEffect, useState } from 'react';
import { getPresenceId, multiplayerConfigured, pingPresence } from './multiplayer/client';
import type { RoomSeat } from './multiplayer/types';
import { setSoundEnabled, soundEnabled } from './ui/sound';
import { IconButton } from './ui/controls';
import HomeDashboard from './ui/HomeDashboard';
import FirstRunOnboarding from './onboarding/FirstRunOnboarding';
import {
  boardAppearanceLabel,
  hasCompletedOnboarding,
  loadBoardAppearance,
  saveBoardAppearance,
  type BoardAppearance,
} from './onboarding/preferences';

const LocalGame = lazy(() => import('./LocalGame'));
const OnlineArena = lazy(() => import('./multiplayer/OnlineArena'));
const RandomMatchmaking = lazy(() => import('./multiplayer/RandomMatchmaking'));
const TournamentHub = lazy(() => import('./tournaments/TournamentHub'));
const Premium3DGate = lazy(() => import('./premium/Premium3DGate'));
const ProfileHub = lazy(() => import('./profile/ProfileHub'));

type Screen = 'home' | 'local' | 'online' | 'matchmaking' | 'tournaments' | '3d' | 'account';
type LocalMode = 'human' | 'ai';
type Theme = 'light' | 'dark';
type FontScale = 'default' | 'large' | 'extra';

function initialScreen(): Screen {
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) return 'online';
  const checkoutKind = params.get('kind');
  const checkoutState = params.get('checkout');
  if ((checkoutState === 'success' || checkoutState === 'cancel') && (checkoutKind === 'position_bid' || checkoutKind === 'color_bid')) return 'online';
  if ((checkoutState === 'success' || checkoutState === 'cancel') && checkoutKind === 'premium3d') return '3d';
  if (checkoutState === 'success') return 'tournaments';
  return 'home';
}

function initialTheme(): Theme {
  const saved = window.localStorage.getItem('qqurz:theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return 'dark';
}

function initialFontScale(): FontScale {
  const saved = window.localStorage.getItem('qqurz:font-scale');
  return saved === 'large' || saved === 'extra' ? saved : 'default';
}

function profileName(): string {
  try {
    const raw = window.localStorage.getItem('qqurz:profile');
    const value = raw ? JSON.parse(raw) as { username?: string } : null;
    return value?.username?.trim() || 'Guest';
  } catch {
    return 'Guest';
  }
}

function fontScaleLabel(value: FontScale): string {
  if (value === 'large') return 'Large';
  if (value === 'extra') return 'Extra large';
  return 'Default';
}

function LoadingView() {
  return (
    <div className="qqurz-loading chess-loading" role="status" aria-live="polite">
      <span className="qqurz-loading-knight">♞</span>
      <strong>Loading</strong>
    </div>
  );
}

export default function AppV14() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [localMode, setLocalMode] = useState<LocalMode>('human');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [fontScale, setFontScale] = useState<FontScale>(initialFontScale);
  const [boardAppearance, setBoardAppearance] = useState<BoardAppearance>(loadBoardAppearance);
  const [onboardingComplete, setOnboardingComplete] = useState(hasCompletedOnboarding);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [onlineVariant, setOnlineVariant] = useState<'friends' | 'tournament'>('friends');
  const [onlinePlayers, setOnlinePlayers] = useState<number | null>(null);
  const [presenceId] = useState(getPresenceId);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('qqurz:theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.fontScale = fontScale;
    window.localStorage.setItem('qqurz:font-scale', fontScale);
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.dataset.boardTheme = boardAppearance;
    saveBoardAppearance(boardAppearance);
  }, [boardAppearance]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./LocalGame');
      void import('./multiplayer/OnlineArena');
      void import('./multiplayer/RandomMatchmaking');
    }, 420);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!onboardingComplete || !multiplayerConfigured) return;
    let stopped = false;
    const ping = async () => {
      try {
        const presence = await pingPresence(profileName(), presenceId);
        if (!stopped) setOnlinePlayers(presence.onlinePlayers);
      } catch {
        // Presence is informational; a temporary network failure should not block the app.
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') void ping(); };
    void ping();
    const timer = window.setInterval(() => void ping(), 20_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onboardingComplete, presenceId]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!displayOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setDisplayOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [displayOpen]);

  const closeMenus = () => { setDisplayOpen(false); setMenuOpen(false); };
  const goHome = () => {
    const url = new URL(window.location.href);
    ['room', 'checkout', 'kind', 'item', 'session_id', 'color'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
    closeMenus();
    setScreen('home');
  };

  const openLocal = (mode: LocalMode) => {
    setLocalMode(mode);
    closeMenus();
    setScreen('local');
  };

  const openFriends = () => {
    setOnlineVariant('friends');
    closeMenus();
    setScreen('online');
  };

  const openMatchmaking = () => {
    closeMenus();
    setScreen('matchmaking');
  };

  const openScreen = (next: Screen) => {
    closeMenus();
    setScreen(next);
  };

  const openDisplaySettings = () => {
    setMenuOpen(false);
    setDisplayOpen(true);
  };

  const cycleTextSize = () => {
    setFontScale(value => value === 'default' ? 'large' : value === 'large' ? 'extra' : 'default');
  };

  const cycleBoardAppearance = () => {
    setBoardAppearance(value => value === 'walnut' ? 'tournament' : value === 'tournament' ? 'slate' : 'walnut');
  };

  const handleRandomMatch = (_seat: RoomSeat) => {
    setOnlineVariant('friends');
    closeMenus();
    setScreen('online');
  };

  const applySound = (value: boolean) => {
    setSoundOn(value);
    setSoundEnabled(value);
  };

  const toggleSound = () => applySound(!soundOn);

  if (!onboardingComplete) {
    return (
      <FirstRunOnboarding
        initialBoardAppearance={boardAppearance}
        initialSoundOn={soundOn}
        onBoardAppearanceChange={setBoardAppearance}
        onSoundChange={applySound}
        onComplete={() => setOnboardingComplete(true)}
      />
    );
  }

  const onlineLabel = onlinePlayers === null ? 'Connecting…' : `${onlinePlayers.toLocaleString()} online`;

  return (
    <main className="qqurz-app-v14 qqurz-app-v22 qqurz-app-v24 qqurz-product-system">
      <header className="qqurz-nav chess-topbar">
        <IconButton className="mobile-menu-button" size="sm" onClick={() => setMenuOpen(true)} aria-label="Open chess menu" aria-expanded={menuOpen}>☰</IconButton>

        <button className="qqurz-wordmark" onClick={goHome} aria-label="QQURZ Chess home">
          <span className="wordmark-piece" aria-hidden="true">♞</span>
          <span className="wordmark-copy"><b>QQURZ</b><small>Competitive Chess960</small></span>
        </button>

        <nav className="desktop-chess-nav" aria-label="Primary navigation">
          <button onClick={goHome} className={screen === 'home' ? 'active' : ''}><span>♚</span> Home</button>
          <button onClick={() => openScreen('tournaments')} className={screen === 'tournaments' ? 'active' : ''}><span>♛</span> Tournaments</button>
          <button onClick={openFriends} className={screen === 'online' && onlineVariant === 'friends' ? 'active' : ''}><span>♞</span> Friends</button>
          <button onClick={() => openScreen('3d')} className={screen === '3d' ? 'active' : ''}><span>♜</span> 3D</button>
        </nav>

        <div className="qqurz-nav-end chess-nav-actions">
          <button className="live-presence-pill" onClick={openMatchmaking} aria-label={`${onlineLabel}. Find a random opponent.`}><span className="presence-dot" /><span className="live-presence-copy">{onlineLabel}</span></button>
          <button className="nav-account-button" onClick={() => openScreen('account')} aria-label="Open player profile"><span aria-hidden="true">♙</span><span className="nav-control-label">Profile</span></button>
          <button className="display-toggle" onClick={() => setDisplayOpen(value => !value)} aria-expanded={displayOpen} aria-controls="qqurz-display-menu"><span aria-hidden="true">Aa</span><span className="nav-control-label">Display</span></button>
        </div>

        <div className="mobile-nav-actions" aria-label="Quick actions">
          <IconButton className="mobile-presence-button" size="sm" onClick={openMatchmaking} aria-label={`${onlineLabel}. Find a random opponent.`}><span className="presence-dot" /></IconButton>
          <IconButton className="mobile-account-button" size="sm" onClick={() => openScreen('account')} aria-label="Open player profile">♙</IconButton>
        </div>
      </header>

      {displayOpen && (
        <section className="display-popover app-display-popover" id="qqurz-display-menu" aria-label="Display and accessibility settings">
          <div className="display-popover-heading"><strong>Display & accessibility</strong><button onClick={() => setDisplayOpen(false)} aria-label="Close display settings">×</button></div>
          <div className="display-setting-block">
            <span>Text size</span>
            <div className="font-scale-options" role="radiogroup" aria-label="Text size">
              <button className={fontScale === 'default' ? 'selected' : ''} onClick={() => setFontScale('default')}>Default</button>
              <button className={fontScale === 'large' ? 'selected' : ''} onClick={() => setFontScale('large')}>Large</button>
              <button className={fontScale === 'extra' ? 'selected' : ''} onClick={() => setFontScale('extra')}>Extra large</button>
            </div>
          </div>
          <div className="display-setting-row"><span>App theme</span><button onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Light' : 'Dark'}</button></div>
          <div className="display-setting-row"><span>Board appearance</span><button onClick={cycleBoardAppearance}>{boardAppearanceLabel(boardAppearance)}</button></div>
          <div className="display-setting-row"><span>Game sounds</span><button onClick={toggleSound}>{soundOn ? 'On' : 'Off'}</button></div>
        </section>
      )}

      {menuOpen && (
        <div className="chess-drawer-backdrop" role="presentation" onPointerDown={() => setMenuOpen(false)}>
          <aside className="chess-drawer" role="dialog" aria-modal="true" aria-label="QQURZ menu" onPointerDown={event => event.stopPropagation()}>
            <div className="drawer-head">
              <button className="qqurz-wordmark" onClick={goHome}><span className="wordmark-piece">♞</span><span className="wordmark-copy"><b>QQURZ</b><small>Chess960</small></span></button>
              <button className="drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>
            </div>
            <nav className="drawer-links" aria-label="Chess menu">
              <button onClick={() => openScreen('tournaments')}><span>♛</span><div><b>Play a tournament</b><small>QQURZ competitive events</small></div></button>
              <button onClick={openFriends}><span>♘</span><div><b>Play a friend</b><small>Create or join a private room</small></div></button>
              <button onClick={() => openLocal('human')}><span>♟</span><div><b>Same device</b><small>Two players, one board</small></div></button>
              <button onClick={() => openScreen('3d')}><span>♜</span><div><b>Premium 3D</b><small>Physical board experience</small></div></button>
              <button onClick={() => openScreen('account')}><span>♙</span><div><b>Profile</b><small>Your player identity</small></div></button>
              <button className="drawer-ai-choice" onClick={() => openLocal('ai')}><span>♞</span><div><b>Practice with AI</b><small>Stockfish training only</small></div></button>
            </nav>
            <div className="drawer-live-match">
              <div><span className="presence-dot"/><b>{onlineLabel}</b><small>Players seen on QQURZ recently</small></div>
              <button onClick={openMatchmaking}>Find an opponent</button>
            </div>
            <div className="drawer-settings" aria-label="Preferences and settings">
              <button onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}><span>◐</span><div><b>App theme</b><small>{theme === 'dark' ? 'Dark' : 'Light'}</small></div></button>
              <button onClick={cycleBoardAppearance}><span>▦</span><div><b>Board</b><small>{boardAppearanceLabel(boardAppearance)}</small></div></button>
              <button onClick={toggleSound}><span>{soundOn ? '♪' : '×'}</span><div><b>Sound</b><small>{soundOn ? 'On' : 'Off'}</small></div></button>
              <button onClick={cycleTextSize}><span>Aa</span><div><b>Text size</b><small>{fontScaleLabel(fontScale)}</small></div></button>
              <button onClick={openDisplaySettings}><span>◎</span><div><b>Accessibility</b><small>Readable display controls</small></div></button>
              <button onClick={openDisplaySettings}><span>⚙</span><div><b>Settings</b><small>Display and preferences</small></div></button>
            </div>
          </aside>
        </div>
      )}

      {screen === 'home' && (
        <HomeDashboard
          onlineLabel={onlineLabel}
          onProfile={() => openScreen('account')}
          onTournament={() => openScreen('tournaments')}
          onFriend={openFriends}
          onSameDevice={() => openLocal('human')}
          onMatchmaking={openMatchmaking}
          onPremium3D={() => openScreen('3d')}
          onAI={() => openLocal('ai')}
        />
      )}

      {screen === 'local' && <Suspense fallback={<LoadingView/>}><div className="qqurz-local-v14"><LocalGame key={localMode} initialMode={localMode}/></div></Suspense>}
      {screen === 'online' && <Suspense fallback={<LoadingView/>}><div className="qqurz-content-page"><OnlineArena onClose={goHome} variant={onlineVariant}/></div></Suspense>}
      {screen === 'matchmaking' && <Suspense fallback={<LoadingView/>}><RandomMatchmaking onlinePlayers={onlinePlayers} onOnlinePlayers={setOnlinePlayers} onMatched={handleRandomMatch} onBack={goHome}/></Suspense>}
      {screen === 'tournaments' && <Suspense fallback={<LoadingView/>}><TournamentHub onBack={goHome} onPlayOnline={() => { setOnlineVariant('tournament'); setScreen('online'); }} onShow3D={() => setScreen('3d')}/></Suspense>}
      {screen === '3d' && <Suspense fallback={<LoadingView/>}><Premium3DGate onBack={goHome}/></Suspense>}
      {screen === 'account' && <Suspense fallback={<LoadingView/>}><ProfileHub onBack={goHome}/></Suspense>}
    </main>
  );
}