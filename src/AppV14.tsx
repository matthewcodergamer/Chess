import { lazy, Suspense, useEffect, useState } from 'react';
import { setSoundEnabled, soundEnabled } from './ui/sound';

const LocalGame = lazy(() => import('./LocalGame'));
const OnlineArena = lazy(() => import('./multiplayer/OnlineArena'));
const TournamentHub = lazy(() => import('./tournaments/TournamentHub'));
const Premium3DGate = lazy(() => import('./premium/Premium3DGate'));
const ProfileHub = lazy(() => import('./profile/ProfileHub'));

const BRAND_LOGO = `${import.meta.env.BASE_URL}brand/qqurz-logo.jpg`;

type Screen = 'home' | 'local' | 'online' | 'tournaments' | '3d' | 'account';
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
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialFontScale(): FontScale {
  const saved = window.localStorage.getItem('qqurz:font-scale');
  return saved === 'large' || saved === 'extra' ? saved : 'default';
}

function LoadingView() {
  return (
    <div className="qqurz-loading" role="status" aria-live="polite">
      <span className="qqurz-loading-knight">♞</span>
      <strong>Opening board…</strong>
    </div>
  );
}

export default function AppV14() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [localMode, setLocalMode] = useState<LocalMode>('human');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [fontScale, setFontScale] = useState<FontScale>(initialFontScale);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [onlineVariant, setOnlineVariant] = useState<'friends' | 'tournament'>('friends');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('qqurz:theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.fontScale = fontScale;
    window.localStorage.setItem('qqurz:font-scale', fontScale);
  }, [fontScale]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./LocalGame');
      void import('./multiplayer/OnlineArena');
    }, 420);
    return () => window.clearTimeout(timer);
  }, []);

  const goHome = () => {
    const url = new URL(window.location.href);
    ['room', 'checkout', 'kind', 'item', 'session_id', 'color'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
    setDisplayOpen(false);
    setScreen('home');
  };

  const openLocal = (mode: LocalMode) => {
    setLocalMode(mode);
    setDisplayOpen(false);
    setScreen('local');
  };

  const openFriends = () => {
    setOnlineVariant('friends');
    setDisplayOpen(false);
    setScreen('online');
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
  };

  return (
    <main className="qqurz-app-v14 qqurz-app-v22">
      <header className="qqurz-nav qqurz-nav-v22">
        <button className="qqurz-brand-button" onClick={goHome} aria-label="QQURZ Chess home">
          <img src={BRAND_LOGO} alt="QQURZ" />
          <span>Chess</span>
        </button>

        <nav aria-label="Primary navigation">
          <button onClick={goHome} className={screen === 'home' ? 'active' : ''}>Home</button>
          <button onClick={() => setScreen('tournaments')} className={screen === 'tournaments' ? 'active' : ''}>Tournaments</button>
          <button onClick={openFriends} className={screen === 'online' && onlineVariant === 'friends' ? 'active' : ''}>Friends</button>
          <button onClick={() => setScreen('3d')} className={screen === '3d' ? 'active' : ''}>3D</button>
        </nav>

        <div className="qqurz-nav-end">
          <button className="nav-account-button" onClick={() => setScreen('account')} aria-label="Open player profile">
            <span aria-hidden="true">♟</span><span className="nav-control-label">Profile</span>
          </button>
          <div className="display-control-wrap">
            <button className="display-toggle" onClick={() => setDisplayOpen(value => !value)} aria-expanded={displayOpen} aria-controls="qqurz-display-menu">
              <span aria-hidden="true">Aa</span><span className="nav-control-label">Display</span>
            </button>
            {displayOpen && (
              <section className="display-popover" id="qqurz-display-menu" aria-label="Display settings">
                <div className="display-popover-heading"><strong>Display</strong><button onClick={() => setDisplayOpen(false)} aria-label="Close display settings">×</button></div>
                <div className="display-setting-block">
                  <span>Text size</span>
                  <div className="font-scale-options" role="radiogroup" aria-label="Text size">
                    <button className={fontScale === 'default' ? 'selected' : ''} onClick={() => setFontScale('default')}>Default</button>
                    <button className={fontScale === 'large' ? 'selected' : ''} onClick={() => setFontScale('large')}>Large</button>
                    <button className={fontScale === 'extra' ? 'selected' : ''} onClick={() => setFontScale('extra')}>Extra large</button>
                  </div>
                </div>
                <div className="display-setting-row"><span>Theme</span><button onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Light' : 'Dark'}</button></div>
                <div className="display-setting-row"><span>Game sounds</span><button onClick={toggleSound}>{soundOn ? 'On' : 'Off'}</button></div>
              </section>
            )}
          </div>
        </div>
      </header>

      {screen === 'home' && (
        <div className="qqurz-home-v14 qqurz-home-v22">
          <section className="home-hero-v22">
            <div className="hero-copy-v22">
              <span className="qqurz-kicker">CHESS960 · SIMPLE BY DESIGN</span>
              <h1>Play chess.<br/>No clutter.</h1>
              <p>Pick how you want to play and get to the board. The complicated stuff stays out of your way until you actually need it.</p>
              <div className="hero-actions-v22">
                <button className="hero-primary-v22" onClick={() => openLocal('ai')}>Play the AI <span>→</span></button>
                <button className="hero-secondary-v22" onClick={openFriends}>Play a friend</button>
              </div>
            </div>
            <div className="hero-board-mark-v22" aria-hidden="true">
              <div className="hero-piece-v22">♞</div>
              <span>960</span>
            </div>
          </section>

          <section className="home-mode-grid-v22" aria-label="Choose a way to play">
            <button onClick={() => openLocal('ai')}>
              <span className="mode-icon-v22">♞</span>
              <span><b>Play AI</b><small>Choose a strength and start.</small></span>
              <i>›</i>
            </button>
            <button onClick={() => openLocal('human')}>
              <span className="mode-icon-v22">♟</span>
              <span><b>Same device</b><small>Two players, one board.</small></span>
              <i>›</i>
            </button>
            <button onClick={openFriends}>
              <span className="mode-icon-v22">◎</span>
              <span><b>Friends online</b><small>Create or join a private room.</small></span>
              <i>›</i>
            </button>
            <button onClick={() => setScreen('tournaments')}>
              <span className="mode-icon-v22">♛</span>
              <span><b>Tournaments</b><small>Pick a field and entry tier.</small></span>
              <i>›</i>
            </button>
          </section>

          <section className="home-premium-strip-v22">
            <div><span className="qqurz-kicker">PREMIUM 3D</span><h2>The same game, rendered in 3D.</h2><p>Physical board, physical clock, touch camera controls.</p></div>
            <button onClick={() => setScreen('3d')}>See 3D <span>→</span></button>
          </section>

          <footer className="qqurz-home-footer qqurz-home-footer-v22"><span>QQURZ Chess</span><span>Fast to learn. Easy to read. Built for touch.</span></footer>
        </div>
      )}

      {screen === 'local' && <Suspense fallback={<LoadingView/>}><div className="qqurz-local-v14"><LocalGame key={localMode} initialMode={localMode}/></div></Suspense>}
      {screen === 'online' && <Suspense fallback={<LoadingView/>}><div className="qqurz-content-page"><OnlineArena onClose={goHome} variant={onlineVariant}/></div></Suspense>}
      {screen === 'tournaments' && <Suspense fallback={<LoadingView/>}><TournamentHub onBack={goHome} onPlayOnline={() => { setOnlineVariant('tournament'); setScreen('online'); }} onShow3D={() => setScreen('3d')}/></Suspense>}
      {screen === '3d' && <Suspense fallback={<LoadingView/>}><Premium3DGate onBack={goHome}/></Suspense>}
      {screen === 'account' && <Suspense fallback={<LoadingView/>}><ProfileHub onBack={goHome}/></Suspense>}

      <nav className="mobile-dock-v22" aria-label="Mobile navigation">
        <button className={screen === 'home' ? 'active' : ''} onClick={goHome}><span>⌂</span><b>Home</b></button>
        <button className={screen === 'local' && localMode === 'ai' ? 'active' : ''} onClick={() => openLocal('ai')}><span>♞</span><b>Play</b></button>
        <button className={screen === 'tournaments' ? 'active' : ''} onClick={() => setScreen('tournaments')}><span>♛</span><b>Events</b></button>
        <button className={screen === 'online' ? 'active' : ''} onClick={openFriends}><span>◎</span><b>Friends</b></button>
        <button className={screen === 'account' ? 'active' : ''} onClick={() => setScreen('account')}><span>♟</span><b>Profile</b></button>
      </nav>
    </main>
  );
}
