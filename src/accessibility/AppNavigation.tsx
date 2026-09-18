import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '../ui/controls';
import { boardAppearanceLabel, type BoardAppearance } from '../onboarding/preferences';
import { useAccessibilityPreferences } from './preferences';
import AccessibilityPanel from './AccessibilityPanel';

type Screen = 'home' | 'local' | 'online' | 'matchmaking' | 'tournaments' | '3d' | 'account';
type IntentHandlers = Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onPointerEnter' | 'onFocus' | 'onPointerDown'>;

type Props = {
  screen: Screen;
  onlineVariant: 'friends' | 'tournament';
  onlineLabel: string;
  theme: 'light' | 'dark';
  boardAppearance: BoardAppearance;
  soundOn: boolean;
  onSoundChange: (enabled: boolean) => void;
  onToggleTheme: () => void;
  onCycleBoardAppearance: () => void;
  onHome: () => void;
  onTournaments: () => void;
  onFriends: () => void;
  onSameDevice: () => void;
  onAI: () => void;
  onMatchmaking: () => void;
  onPremium3D: () => void;
  onAccount: () => void;
  intent: (screen: Screen) => IntentHandlers;
};

type NavIconName = 'menu' | 'home' | 'trophy' | 'users' | 'cube' | 'pawn' | 'user' | 'sun' | 'board' | 'sound' | 'type' | 'accessibility';

function NavIcon({ name, className = '' }: { name: NavIconName; className?: string }) {
  const paths: Record<NavIconName, ReactNode> = {
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    home: <><path d="m4 10 8-6 8 6" /><path d="M6.5 9.5V20h11V9.5M10 20v-5h4v5" /></>,
    trophy: <><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" /><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 12v4M8 20h8M9 16h6" /></>,
    users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 18a4.5 4.5 0 0 1 7 0" /></>,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
    pawn: <><circle cx="12" cy="6.5" r="3" /><path d="M8.5 10h7l-1.5 5 3 4H7l3-4-1.5-5Z" /><path d="M6 21h12" /></>,
    user: <><circle cx="12" cy="8" r="3.25" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
    board: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 16h16M10 4v16M16 4v16" /></>,
    sound: <><path d="M5 10v4h4l5 4V6l-5 4H5Z" /><path d="M18 9a4 4 0 0 1 0 6M20.5 6.5a7.5 7.5 0 0 1 0 11" /></>,
    type: <><path d="M5 5h14M12 5v14M8 19h8" /></>,
    accessibility: <><circle cx="12" cy="5" r="2" /><path d="M5 9h14M12 9v10M8 20l4-6 4 6" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  if (!buttons.length) return;
  const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
  let next = current;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
  else next = (current + 1) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
}

function fontScaleLabel(value: 'default' | 'large' | 'extra'): string {
  if (value === 'large') return 'Large';
  if (value === 'extra') return 'Extra large';
  return 'Default';
}

export default function AppNavigation({
  screen,
  onlineVariant,
  onlineLabel,
  theme,
  boardAppearance,
  soundOn,
  onSoundChange,
  onToggleTheme,
  onCycleBoardAppearance,
  onHome,
  onTournaments,
  onFriends,
  onSameDevice,
  onAI,
  onMatchmaking,
  onPremium3D,
  onAccount,
  intent,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [preferences, updatePreferences] = useAccessibilityPreferences();
  const displayButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeDisplay = useCallback(() => setDisplayOpen(false), []);

  const closeNavigation = () => {
    setMenuOpen(false);
    setDisplayOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return;
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.drawer-close')?.focus());
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!displayOpen) return;
    return () => {
      requestAnimationFrame(() => displayButtonRef.current?.focus());
    };
  }, [displayOpen]);

  const run = (action: () => void) => {
    closeNavigation();
    action();
  };

  const cycleTextSize = () => {
    updatePreferences({ fontScale: preferences.fontScale === 'default' ? 'large' : preferences.fontScale === 'large' ? 'extra' : 'default' });
  };

  return <>
    <a className="qqurz-skip-link" href="#qqurz-main-content">Skip to main content</a>
    <header className="qqurz-nav chess-topbar">
      <IconButton className="mobile-menu-button" size="sm" onClick={() => setMenuOpen(true)} aria-label="Open chess menu" aria-expanded={menuOpen}><NavIcon name="menu" /></IconButton>

      <button className="qqurz-wordmark" onClick={() => run(onHome)} aria-label="qqurzchess home">
        <span className="wordmark-pawn" aria-hidden="true"><NavIcon name="pawn" /></span><span className="wordmark-copy"><b>qqurzchess</b></span>
      </button>

      <nav className="desktop-chess-nav" aria-label="Primary navigation" onKeyDown={moveFocus}>
        <button onClick={() => run(onHome)} className={screen === 'home' ? 'active' : ''} aria-current={screen === 'home' ? 'page' : undefined}><NavIcon name="home" /> Home</button>
        <button onClick={() => run(onTournaments)} {...intent('tournaments')} className={screen === 'tournaments' ? 'active' : ''} aria-current={screen === 'tournaments' ? 'page' : undefined}><NavIcon name="trophy" /> Tournaments</button>
        <button onClick={() => run(onFriends)} {...intent('online')} className={screen === 'online' && onlineVariant === 'friends' ? 'active' : ''} aria-current={screen === 'online' && onlineVariant === 'friends' ? 'page' : undefined}><NavIcon name="users" /> Friends</button>
        <button onClick={() => run(onPremium3D)} {...intent('3d')} className={screen === '3d' ? 'active' : ''} aria-current={screen === '3d' ? 'page' : undefined}><NavIcon name="cube" /> 3D</button>
      </nav>

      <div className="qqurz-nav-end chess-nav-actions">
        <button className="live-presence-pill" onClick={() => run(onMatchmaking)} {...intent('matchmaking')} aria-label={`${onlineLabel}. Find a random opponent.`}><span className="presence-dot" aria-hidden="true"/><span className="live-presence-copy">{onlineLabel}</span></button>
        <button className="nav-account-button" onClick={() => run(onAccount)} {...intent('account')} aria-label="Open player account" aria-current={screen === 'account' ? 'page' : undefined}><NavIcon name="user" /><span className="nav-control-label">Account</span></button>
        <button ref={displayButtonRef} className="display-toggle" onClick={() => setDisplayOpen(value => !value)} aria-expanded={displayOpen} aria-controls="qqurz-display-menu" aria-label="Display and accessibility settings"><span aria-hidden="true">Aa</span><span className="nav-control-label">Display</span></button>
      </div>

      <div className="mobile-nav-actions" aria-label="Quick actions">
        <IconButton className="mobile-presence-button" size="sm" onClick={() => run(onMatchmaking)} {...intent('matchmaking')} aria-label={`${onlineLabel}. Find a random opponent.`}><span className="presence-dot" /></IconButton>
        <IconButton className="mobile-account-button" size="sm" onClick={() => run(onAccount)} {...intent('account')} aria-label="Open player account"><NavIcon name="user" /></IconButton>
      </div>
    </header>

    <AccessibilityPanel
      open={displayOpen}
      onClose={closeDisplay}
      theme={theme}
      onToggleTheme={onToggleTheme}
      boardAppearance={boardAppearanceLabel(boardAppearance)}
      onCycleBoardAppearance={onCycleBoardAppearance}
      onSoundChange={onSoundChange}
    />

    {menuOpen && <div className="chess-drawer-backdrop" role="presentation" onPointerDown={() => setMenuOpen(false)}>
      <aside className="chess-drawer" role="dialog" aria-modal="true" aria-label="qqurzchess menu" onPointerDown={event => event.stopPropagation()}>
        <div className="drawer-head">
          <button className="qqurz-wordmark" onClick={() => run(onHome)} aria-label="qqurzchess home"><span className="wordmark-copy"><b>qqurzchess</b></span></button>
          <button className="drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>
        </div>
        <nav className="drawer-links" aria-label="Chess menu" onKeyDown={moveFocus}>
          <button onClick={() => run(onTournaments)} {...intent('tournaments')}><span className="drawer-glyph"><NavIcon name="trophy" /></span><div><b>Play a tournament</b><small>Competitive Chess960 events</small></div></button>
          <button onClick={() => run(onFriends)} {...intent('online')}><span className="drawer-glyph"><NavIcon name="users" /></span><div><b>Play a friend</b><small>Create or join a private room</small></div></button>
          <button onClick={() => run(onSameDevice)} {...intent('local')}><span className="drawer-glyph"><NavIcon name="board" /></span><div><b>Same device</b><small>Two players, one board</small></div></button>
          <button onClick={() => run(onPremium3D)} {...intent('3d')}><span className="drawer-glyph"><NavIcon name="cube" /></span><div><b>Premium 3D</b><small>Physical board experience</small></div></button>
          <button onClick={() => run(onAccount)} {...intent('account')}><span className="drawer-glyph"><NavIcon name="user" /></span><div><b>Account</b><small>Identity, ratings and settings</small></div></button>
          <button className="drawer-ai-choice" onClick={() => run(onAI)} {...intent('local')}><span className="drawer-glyph"><NavIcon name="cube" /></span><div><b>Practice with AI</b><small>Stockfish training only</small></div></button>
        </nav>
        <div className="drawer-live-match">
          <div><span className="presence-dot" aria-hidden="true"/><b>{onlineLabel}</b><small>Players seen recently</small></div>
          <button onClick={() => run(onMatchmaking)} {...intent('matchmaking')}>Find an opponent</button>
        </div>
        <div className="drawer-settings" aria-label="Preferences and settings">
          <button onClick={onToggleTheme}><span aria-hidden="true"><NavIcon name="sun" /></span><div><b>App theme</b><small>{theme === 'dark' ? 'Dark' : 'Light'}</small></div></button>
          <button onClick={onCycleBoardAppearance}><span aria-hidden="true"><NavIcon name="board" /></span><div><b>Board</b><small>{boardAppearanceLabel(boardAppearance)}</small></div></button>
          <button onClick={() => onSoundChange(!soundOn)}><span aria-hidden="true"><NavIcon name="sound" /></span><div><b>Sound</b><small>{soundOn ? 'On' : 'Off'}</small></div></button>
          <button onClick={cycleTextSize}><span aria-hidden="true"><NavIcon name="type" /></span><div><b>Text size</b><small>{fontScaleLabel(preferences.fontScale)}</small></div></button>
          <button onClick={() => { setMenuOpen(false); setDisplayOpen(true); }}><span aria-hidden="true"><NavIcon name="accessibility" /></span><div><b>Accessibility</b><small>Contrast, motion, coordinates & feedback</small></div></button>
        </div>
      </aside>
    </div>}
  </>;
}
