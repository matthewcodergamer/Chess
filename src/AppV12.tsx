import { useEffect, useRef, useState } from 'react';
import App from './App';
import OnlineArena from './multiplayer/OnlineArena';

const BRAND_LOGO = `${import.meta.env.BASE_URL}brand/qqurz-logo.jpg`;
type Screen = 'home' | 'local' | 'online';
type LocalPreference = 'human' | 'ai';

function textOf(element: Element): string {
  return (element.textContent || '').trim();
}

function hasRoomInvite(): boolean {
  return Boolean(new URLSearchParams(window.location.search).get('room'));
}

export default function AppV12() {
  const [screen, setScreen] = useState<Screen>(() => hasRoomInvite() ? 'online' : 'home');
  const [preference, setPreference] = useState<LocalPreference>('human');
  const [canReturnHome, setCanReturnHome] = useState(false);
  const localRoot = useRef<HTMLDivElement | null>(null);

  const openLocal = (mode: LocalPreference) => {
    setPreference(mode);
    setScreen('local');
  };

  const goHome = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
    setScreen('home');
  };

  useEffect(() => {
    if (screen !== 'local') return;
    const timer = window.setTimeout(() => {
      if (preference !== 'ai') return;
      const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-card'));
      cards.find(card => /play the ai/i.test(textOf(card)))?.click();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [preference, screen]);

  useEffect(() => {
    if (screen !== 'local' || !localRoot.current) return;
    const root = localRoot.current;

    const polish = () => {
      const desktopMark = root.querySelector<HTMLElement>('.brand-mark');
      if (desktopMark && !desktopMark.classList.contains('qqurz-runtime-logo')) {
        desktopMark.classList.add('qqurz-runtime-logo');
        desktopMark.textContent = '';
        const image = document.createElement('img');
        image.src = BRAND_LOGO;
        image.alt = 'QQURZ';
        desktopMark.append(image);
      }

      const brandTitle = root.querySelector<HTMLElement>('.brand-row h1');
      if (brandTitle && brandTitle.textContent !== 'QQURZ CHESS') brandTitle.textContent = 'QQURZ CHESS';
      const brandSubtitle = root.querySelector<HTMLElement>('.brand-row p');
      if (brandSubtitle) brandSubtitle.textContent = 'Freestyle tournament platform';
      const mobileBrand = root.querySelector<HTMLElement>('.mobile-header .eyebrow');
      if (mobileBrand) mobileBrand.textContent = 'QQURZ CHESS';

      const activeGame = Boolean(root.querySelector('.player-clock.active, .mobile-clocks .active'));
      const strategy = Boolean(root.querySelector('.strategy-card, .strategy-overlay'));
      const ended = Boolean(root.querySelector('.board-overlay.ended'));
      const setup = Boolean(root.querySelector('.setup-state'));
      setCanReturnHome(setup || ended);

      root.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
        const label = textOf(button);
        if (/^shuffle new match$/i.test(label) || /^shuffle$/i.test(label)) {
          button.textContent = activeGame ? 'Pattern Locked' : 'Choose Pattern';
          button.disabled = activeGame;
        }
        if (/^start clocks now$/i.test(label) || /^start now$/i.test(label)) {
          button.textContent = 'Start Now';
          button.classList.add('start-now-pill');
        }
        if (activeGame && /^reset$/i.test(label)) button.disabled = true;
      });

      const boardFrame = root.querySelector<HTMLElement>('.board-frame');
      if (boardFrame) {
        const check = Boolean(boardFrame.querySelector('square.check'));
        const checkmate = /checkmate/i.test(textOf(root.querySelector('.end-title') || document.createElement('span')));
        boardFrame.classList.toggle('runtime-check', check && !checkmate);
        boardFrame.classList.toggle('runtime-checkmate', checkmate);
      }

      if (strategy) root.classList.add('qqurz-strategy-active');
      else root.classList.remove('qqurz-strategy-active');
    };

    polish();
    const observer = new MutationObserver(polish);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [screen]);

  if (screen === 'online') {
    return (
      <main className="qqurz-v12-shell">
        <header className="qqurz-topbar">
          <button className="qqurz-logo-button" onClick={goHome} aria-label="QQURZ Chess home">
            <img src={BRAND_LOGO} alt="QQURZ" />
          </button>
          <div><b>Online Multiplayer</b><span>qqurzchess.com · global rooms</span></div>
        </header>
        <OnlineArena onClose={goHome} />
      </main>
    );
  }

  if (screen === 'local') {
    return (
      <div ref={localRoot} className="qqurz-local-wrapper">
        {canReturnHome && (
          <button className="qqurz-home-return" onClick={goHome}>← QQURZ Home</button>
        )}
        <App />
      </div>
    );
  }

  return (
    <main className="qqurz-v12-shell qqurz-home">
      <section className="qqurz-hero">
        <div className="qqurz-hero-logo"><img src={BRAND_LOGO} alt="QQURZ" /></div>
        <span className="brand-domain">qqurzchess.com</span>
        <span className="eyebrow">U.S.-BASED · FREESTYLE CHESS · GLOBAL ONLINE PLAY</span>
        <h1>Choose how you want to play.</h1>
        <p>Play on one device, challenge Stockfish, or create a live QQURZ room for someone on a completely different internet connection anywhere the service is available.</p>
      </section>

      <section className="qqurz-mode-grid" aria-label="Choose game mode">
        <button onClick={() => openLocal('human')}>
          <span aria-hidden="true">👥</span><b>Human vs Human</b><small>Local two-player Chess960.</small>
        </button>
        <button onClick={() => openLocal('ai')}>
          <span aria-hidden="true">🤖</span><b>Play the AI</b><small>Easy, Hard or Crazy Hard Stockfish.</small>
        </button>
        <button className="online" onClick={() => setScreen('online')}>
          <span aria-hidden="true">🌐</span><b>Online Multiplayer</b><small>Create a private room and share its code or invite link.</small>
        </button>
      </section>

      <section className="tournament-preview" aria-label="Tournament roadmap">
        <div className="tournament-heading">
          <div><span className="eyebrow">U.S. TOURNAMENT PLATFORM</span><h3>Serious chess competition, not betting</h3></div>
          <span className="roadmap-pill">Authoritative realtime foundation</span>
        </div>
        <div className="tournament-cards">
          <article>
            <span className="tournament-type free">FREE ONLINE EVENT</span>
            <h4>QQURZ Community Freestyle</h4>
            <p>Server-validated online matches with shared clocks, locked patterns, results and bracket-ready records.</p>
            <button disabled>Free tournament system next</button>
          </article>
          <article className="us-prize-card">
            <span className="tournament-type prize">U.S. PRIZE TOURNAMENT ROADMAP</span>
            <h4>QQURZ Founders Prize Open</h4>
            <strong>$500 example guaranteed prize fund</strong>
            <div className="skill-event-pill">ENTRY-FEE SKILL COMPETITION · NO ODDS · NO WAGERS</div>
            <p>The intended model is a chess tournament entry fee and published prize fund. Real-money checkout remains off until U.S. state eligibility, official rules, age/identity, tax and payout requirements, fair-play controls, and an explicitly approving payment provider are in place.</p>
            <button disabled>Paid registration intentionally disabled</button>
          </article>
        </div>
      </section>
    </main>
  );
}
