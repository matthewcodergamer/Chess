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

function initialScreen(): Screen {
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) return 'online';
  const checkoutKind = params.get('kind');
  const checkoutState = params.get('checkout');
  if ((checkoutState === 'success' || checkoutState === 'cancel') && (checkoutKind === 'position_bid' || checkoutKind === 'color_bid')) return 'online';
  if (checkoutState === 'success' && checkoutKind === 'premium3d') return '3d';
  if (checkoutState === 'cancel' && checkoutKind === 'premium3d') return '3d';
  if (checkoutState === 'success') return 'tournaments';
  return 'home';
}

function initialTheme(): Theme {
  const saved = window.localStorage.getItem('qqurz:theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function LoadingView() {
  return (
    <div className="qqurz-loading" role="status" aria-live="polite">
      <span className="qqurz-loading-knight">♟</span>
      <span>Opening board…</span>
    </div>
  );
}

export default function AppV14() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [localMode, setLocalMode] = useState<LocalMode>('human');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [onlineVariant, setOnlineVariant] = useState<'friends' | 'tournament'>('friends');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('qqurz:theme', theme);
  }, [theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./LocalGame');
      void import('./multiplayer/OnlineArena');
    }, 450);
    return () => window.clearTimeout(timer);
  }, []);

  const goHome = () => {
    const url = new URL(window.location.href);
    ['room', 'checkout', 'kind', 'item', 'session_id', 'color'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
    setScreen('home');
  };

  const openLocal = (mode: LocalMode) => {
    setLocalMode(mode);
    setScreen('local');
  };

  const pageTitle = screen === 'online'
    ? 'Friends Online'
    : screen === 'tournaments'
      ? 'Tournaments'
      : screen === '3d'
        ? 'Premium 3D'
        : screen === 'account'
        ? 'Account'
        : screen === 'local'
          ? localMode === 'ai' ? 'Play AI' : 'Local Match'
          : '';

  return (
    <main className="qqurz-app-v14">
      <header className="qqurz-nav">
        <button className="qqurz-brand-button" onClick={goHome} aria-label="QQURZ Chess home">
          <img src={BRAND_LOGO} alt="QQURZ" />
          <span>Chess</span>
        </button>
        <nav aria-label="Primary navigation">
          <button onClick={() => setScreen('tournaments')} className={screen === 'tournaments' ? 'active' : ''}>Tournaments</button>
          <button onClick={() => { setOnlineVariant('friends'); setScreen('online'); }} className={screen === 'online' && onlineVariant === 'friends' ? 'active' : ''}>Friends</button>
          <button onClick={() => setScreen('3d')} className={screen === '3d' ? 'active' : ''}>3D · $4.99</button>
        </nav>
        <div className="qqurz-nav-end">
          {pageTitle && <span className="qqurz-page-label">{pageTitle}</span>}
          <button className="nav-account-button" onClick={() => setScreen('account')} aria-label="Open QQURZ account">♟</button>
          <button className="sound-toggle" onClick={() => { const next = !soundOn; setSoundOn(next); setSoundEnabled(next); }} aria-label={`${soundOn ? 'Mute' : 'Enable'} game sounds`}>{soundOn ? '♪' : '×♪'}</button>
          <button className="theme-toggle" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            <span aria-hidden="true">{theme === 'light' ? '◐' : '◑'}</span>
          </button>
        </div>
      </header>

      {screen === 'home' && (
        <div className="qqurz-home-v14">
          <section className="qqurz-intro">
            <span className="qqurz-kicker">FREESTYLE CHESS · CHESS960</span>
            <h1>Four ways to play.</h1>
            <p>Challenge Stockfish, share one board, create a private online room with friends, or enter official QQURZ-hosted tournaments.</p>
          </section>
          <section className="qqurz-primary-actions play-paths-v16" aria-label="Choose play mode">
            <button onClick={() => openLocal('ai')}><span className="action-icon">♞</span><span><b>Play the AI</b><small>Easy, Hard or Crazy Hard Stockfish.</small></span><span className="action-arrow">›</span></button>
            <button onClick={() => openLocal('human')}><span className="action-icon">♟</span><span><b>Human vs Human</b><small>Two people on this device.</small></span><span className="action-arrow">›</span></button>
            <button onClick={() => { setOnlineVariant('friends'); setScreen('online'); }}><span className="action-icon">◎</span><span><b>Play Friends Online</b><small>Create a private room and share the invite.</small></span><span className="action-arrow">›</span></button>
            <button onClick={() => setScreen('tournaments')}><span className="action-icon">♛</span><span><b>Official Tournaments</b><small>QQURZ-hosted events from 10 to 100+ seats.</small></span><span className="action-arrow">›</span></button>
          </section>
          <section className="qqurz-home-grid">
            <button className="home-feature-card" onClick={() => setScreen('tournaments')}><span className="feature-badge">QQURZ HOSTED</span><h2>Tournaments built to scale</h2><p>10-player quick events, 32-seat rapid, 100-player Freestyle and larger official formats.</p><span>Browse tournaments →</span></button>
            <button className="home-feature-card premium" onClick={() => setScreen('3d')}><span className="feature-badge">PREMIUM · $4.99</span><h2>Unlock the 3D board</h2><p>Warm walnut squares, brighter lighting, touch camera controls and playable AI or local 3D chess.</p><span>Unlock Premium 3D →</span></button>
          </section>
          <footer className="qqurz-home-footer"><span>qqurzchess.com</span><span>2D included · Premium 3D paid · realtime friends · hosted tournaments</span></footer>
        </div>
      )}

      {screen === 'local' && <Suspense fallback={<LoadingView/>}><div className="qqurz-local-v14"><LocalGame key={localMode} initialMode={localMode}/></div></Suspense>}
      {screen === 'online' && <Suspense fallback={<LoadingView/>}><div className="qqurz-content-page"><OnlineArena onClose={goHome} variant={onlineVariant}/></div></Suspense>}
      {screen === 'tournaments' && <Suspense fallback={<LoadingView/>}><TournamentHub onBack={goHome} onPlayOnline={() => { setOnlineVariant('tournament'); setScreen('online'); }} onShow3D={() => setScreen('3d')}/></Suspense>}
      {screen === '3d' && <Suspense fallback={<LoadingView/>}><Premium3DGate onBack={goHome}/></Suspense>}
      {screen === 'account' && <Suspense fallback={<LoadingView/>}><ProfileHub onBack={goHome}/></Suspense>}
    </main>
  );
}
