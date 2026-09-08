import { lazy, Suspense, useEffect, useState } from 'react';

const LocalGame = lazy(() => import('./LocalGame'));
const OnlineArena = lazy(() => import('./multiplayer/OnlineArena'));
const TournamentHub = lazy(() => import('./tournaments/TournamentHub'));
const PremiumBoard3D = lazy(() => import('./premium/PremiumBoard3D'));

const BRAND_LOGO = `${import.meta.env.BASE_URL}brand/qqurz-logo.jpg`;

type Screen = 'home' | 'local' | 'online' | 'tournaments' | '3d';
type LocalMode = 'human' | 'ai';
type Theme = 'light' | 'dark';

function initialScreen(): Screen {
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) return 'online';
  if (params.get('checkout') === 'success') return 'tournaments';
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
      <span className="qqurz-loading-knight">♞</span>
      <span>Opening board…</span>
    </div>
  );
}

export default function AppV14() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [localMode, setLocalMode] = useState<LocalMode>('human');
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('qqurz:theme', theme);
  }, [theme]);

  // Warm the two most common code paths after the home screen becomes interactive.
  // The expensive Stockfish WASM still waits until an AI position is actually created.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./LocalGame');
      void import('./multiplayer/OnlineArena');
    }, 450);
    return () => window.clearTimeout(timer);
  }, []);

  const goHome = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
    setScreen('home');
  };

  const openLocal = (mode: LocalMode) => {
    setLocalMode(mode);
    setScreen('local');
  };

  const pageTitle = screen === 'online'
    ? 'Online'
    : screen === 'tournaments'
      ? 'Tournaments'
      : screen === '3d'
        ? '3D Board'
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
          <button onClick={() => setScreen('online')} className={screen === 'online' ? 'active' : ''}>Online</button>
          <button onClick={() => setScreen('3d')} className={screen === '3d' ? 'active' : ''}>3D</button>
        </nav>
        <div className="qqurz-nav-end">
          {pageTitle && <span className="qqurz-page-label">{pageTitle}</span>}
          <button
            className="theme-toggle"
            onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            <span aria-hidden="true">{theme === 'light' ? '◐' : '◑'}</span>
          </button>
        </div>
      </header>

      {screen === 'home' && (
        <div className="qqurz-home-v14">
          <section className="qqurz-intro">
            <span className="qqurz-kicker">FREESTYLE CHESS · CHESS960</span>
            <h1>Chess, without the clutter.</h1>
            <p>Fast local games, Stockfish AI, private online rooms, and tournament-ready play from one clean board.</p>
          </section>

          <section className="qqurz-primary-actions" aria-label="Choose play mode">
            <button onClick={() => openLocal('human')}>
              <span className="action-icon">♟</span>
              <span><b>Human vs Human</b><small>Play together on this device.</small></span>
              <span className="action-arrow">›</span>
            </button>
            <button onClick={() => openLocal('ai')}>
              <span className="action-icon">♞</span>
              <span><b>Play the AI</b><small>Stockfish loads only after you create a position.</small></span>
              <span className="action-arrow">›</span>
            </button>
            <button onClick={() => setScreen('online')}>
              <span className="action-icon">◎</span>
              <span><b>Online Multiplayer</b><small>Create a room and invite another player.</small></span>
              <span className="action-arrow">›</span>
            </button>
          </section>

          <section className="qqurz-home-grid">
            <button className="home-feature-card" onClick={() => setScreen('tournaments')}>
              <span className="feature-badge">TOURNAMENTS</span>
              <h2>Entry-fee test events</h2>
              <p>Prototype $1, $5, $10 and $20 entry flows, including a $500 guaranteed-prize event.</p>
              <span>Open tournaments →</span>
            </button>
            <button className="home-feature-card premium" onClick={() => setScreen('3d')}>
              <span className="feature-badge">PREMIUM</span>
              <h2>Low-poly 3D board</h2>
              <p>A separate, lazy-loaded 3D experience so the standard 2D game stays fast.</p>
              <span>Preview 3D →</span>
            </button>
          </section>

          <footer className="qqurz-home-footer">
            <span>qqurzchess.com</span><span>2D first · 3D optional · realtime backend ready</span>
          </footer>
        </div>
      )}

      {screen === 'local' && (
        <Suspense fallback={<LoadingView />}>
          <div className="qqurz-local-v14">
            <LocalGame key={localMode} initialMode={localMode} />
          </div>
        </Suspense>
      )}

      {screen === 'online' && (
        <Suspense fallback={<LoadingView />}>
          <div className="qqurz-content-page">
            <OnlineArena onClose={goHome} />
          </div>
        </Suspense>
      )}

      {screen === 'tournaments' && (
        <Suspense fallback={<LoadingView />}>
          <TournamentHub onBack={goHome} onPlayOnline={() => setScreen('online')} onShow3D={() => setScreen('3d')} />
        </Suspense>
      )}

      {screen === '3d' && (
        <Suspense fallback={<LoadingView />}>
          <PremiumBoard3D onBack={goHome} />
        </Suspense>
      )}
    </main>
  );
}
