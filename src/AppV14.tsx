import { lazy, Suspense, useEffect, useState } from 'react';
import { setSoundEnabled, soundEnabled } from './ui/sound';
import HomeBoardPreview from './ui/HomeBoardPreview';

const LocalGame = lazy(() => import('./LocalGame'));
const OnlineArena = lazy(() => import('./multiplayer/OnlineArena'));
const TournamentHub = lazy(() => import('./tournaments/TournamentHub'));
const Premium3DGate = lazy(() => import('./premium/Premium3DGate'));
const ProfileHub = lazy(() => import('./profile/ProfileHub'));

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
  return 'dark';
}

function initialFontScale(): FontScale {
  const saved = window.localStorage.getItem('qqurz:font-scale');
  return saved === 'large' || saved === 'extra' ? saved : 'default';
}

function LoadingView() {
  return (
    <div className="qqurz-loading chess-loading" role="status" aria-live="polite">
      <span className="qqurz-loading-knight">♞</span>
      <strong>Setting the board…</strong>
    </div>
  );
}

export default function AppV14() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [localMode, setLocalMode] = useState<LocalMode>('human');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [fontScale, setFontScale] = useState<FontScale>(initialFontScale);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

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

  const openScreen = (next: Screen) => {
    closeMenus();
    setScreen(next);
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
  };

  return (
    <main className="qqurz-app-v14 qqurz-app-v22 qqurz-app-v24">
      <header className="qqurz-nav chess-topbar">
        <button className="mobile-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open chess menu" aria-expanded={menuOpen}>☰</button>

        <button className="qqurz-wordmark" onClick={goHome} aria-label="QQURZ Chess home">
          <span className="wordmark-piece" aria-hidden="true">♞</span>
          <span className="wordmark-copy"><b>QQURZ</b><small>Chess960</small></span>
        </button>

        <nav className="desktop-chess-nav" aria-label="Primary navigation">
          <button onClick={goHome} className={screen === 'home' ? 'active' : ''}><span>♚</span> Home</button>
          <button onClick={() => openScreen('tournaments')} className={screen === 'tournaments' ? 'active' : ''}><span>♛</span> Tournaments</button>
          <button onClick={openFriends} className={screen === 'online' && onlineVariant === 'friends' ? 'active' : ''}><span>♞</span> Friends</button>
          <button onClick={() => openScreen('3d')} className={screen === '3d' ? 'active' : ''}><span>♜</span> 3D</button>
        </nav>

        <div className="qqurz-nav-end chess-nav-actions">
          <button className="nav-account-button" onClick={() => openScreen('account')} aria-label="Open player profile"><span aria-hidden="true">♙</span><span className="nav-control-label">Profile</span></button>
          <div className="display-control-wrap">
            <button className="display-toggle" onClick={() => setDisplayOpen(value => !value)} aria-expanded={displayOpen} aria-controls="qqurz-display-menu"><span aria-hidden="true">Aa</span><span className="nav-control-label">Display</span></button>
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
                <div className="display-setting-row"><span>Board theme</span><button onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Light' : 'Dark'}</button></div>
                <div className="display-setting-row"><span>Game sounds</span><button onClick={toggleSound}>{soundOn ? 'On' : 'Off'}</button></div>
              </section>
            )}
          </div>
        </div>
      </header>

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
              <button className="drawer-ai-choice" onClick={() => openLocal('ai')}><span>♞</span><div><b>Play with AI</b><small>Practice against Stockfish</small></div></button>
            </nav>
            <div className="drawer-settings">
              <button onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}><span>◐</span><b>{theme === 'dark' ? 'Dark board theme' : 'Light board theme'}</b></button>
              <button onClick={toggleSound}><span>{soundOn ? '♪' : '×'}</span><b>Sounds {soundOn ? 'on' : 'off'}</b></button>
              <button onClick={() => { setMenuOpen(false); setDisplayOpen(true); }}><span>Aa</span><b>Text & display</b></button>
            </div>
          </aside>
        </div>
      )}

      {screen === 'home' && (
        <div className="qqurz-home-v24">
          <section className="chess-hero-v24">
            <div className="chess-hero-copy">
              <span className="chess-eyebrow">THE QQURZ CHESS CLUB</span>
              <h1>Chess,<br/><em>remixed.</em></h1>
              <p>Enter a tournament, challenge a friend, or sit across the same board. Chess960 competition is the focus; AI stays available when you want to practice.</p>
              <div className="chess-hero-actions">
                <button className="chess-primary-action" onClick={() => openScreen('tournaments')}><span>♛</span><b>Play a tournament</b><i>→</i></button>
                <button className="chess-secondary-action" onClick={openFriends}><span>♘</span><b>Play a friend</b></button>
              </div>
            </div>

            <HomeBoardPreview />
          </section>

          <section className="chess-play-section">
            <div className="section-title-v24"><span>PLAY</span><h2>Choose your match.</h2></div>
            <div className="chess-mode-list">
              <button className="featured" onClick={() => openScreen('tournaments')}><span className="chess-mode-icon">♛</span><span><b>Play a tournament</b><small>Fields, brackets and prize events</small></span><i>Enter →</i></button>
              <button onClick={openFriends}><span className="chess-mode-icon">♘</span><span><b>Play a friend</b><small>Private room and invite code</small></span><i>Connect →</i></button>
              <button onClick={() => openLocal('human')}><span className="chess-mode-icon">♟</span><span><b>Same device</b><small>Pass the board across the table</small></span><i>Open →</i></button>
              <button className="ai-secondary-choice" onClick={() => openLocal('ai')}><span className="chess-mode-icon">♞</span><span><b>Play with AI</b><small>Practice against Stockfish at your level</small></span><i>Practice →</i></button>
            </div>
          </section>

          <section className="chess-feature-band">
            <div className="feature-piece-stack" aria-hidden="true"><span>♜</span><span>♝</span><span>♞</span></div>
            <div><span className="chess-eyebrow">PREMIUM 3D</span><h2>Bring the table to the screen.</h2><p>Play on a physical-style 3D board with the same clock and touch-first controls.</p></div>
            <button onClick={() => openScreen('3d')}>Explore 3D <span>→</span></button>
          </section>

          <footer className="qqurz-home-footer-v24"><span>♚ QQURZ Chess</span><span>Chess960 · Private rooms · Tournaments · 3D</span></footer>
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
