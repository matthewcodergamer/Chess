import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent } from 'react';
import { IconButton } from '../ui/controls';
import { UiIcon } from '../ui/icons';
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

const BRAND_MARK = `${import.meta.env.BASE_URL}brand/qqurz-mark.svg`;

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
      <IconButton className="mobile-menu-button" size="sm" onClick={() => setMenuOpen(true)} aria-label="Open chess menu" aria-expanded={menuOpen}><UiIcon name="menu" /></IconButton>

      <button className="qqurz-wordmark" onClick={() => run(onHome)} aria-label="QQURZ Chess home">
        <img className="wordmark-mark" src={BRAND_MARK} alt="" aria-hidden="true" />
        <span className="wordmark-copy"><b>QQURZ</b><small>Competitive Chess960</small></span>
      </button>

      <nav className="desktop-chess-nav" aria-label="Primary navigation" onKeyDown={moveFocus}>
        <button onClick={() => run(onHome)} className={screen === 'home' ? 'active' : ''} aria-current={screen === 'home' ? 'page' : undefined}><span aria-hidden="true">♚</span> Home</button>
        <button onClick={() => run(onTournaments)} {...intent('tournaments')} className={screen === 'tournaments' ? 'active' : ''} aria-current={screen === 'tournaments' ? 'page' : undefined}><span aria-hidden="true">♛</span> Tournaments</button>
        <button onClick={() => run(onFriends)} {...intent('online')} className={screen === 'online' && onlineVariant === 'friends' ? 'active' : ''} aria-current={screen === 'online' && onlineVariant === 'friends' ? 'page' : undefined}><span aria-hidden="true">♞</span> Friends</button>
        <button onClick={() => run(onPremium3D)} {...intent('3d')} className={screen === '3d' ? 'active' : ''} aria-current={screen === '3d' ? 'page' : undefined}><span aria-hidden="true">♜</span> 3D</button>
      </nav>

      <div className="qqurz-nav-end chess-nav-actions">
        <button className="live-presence-pill" onClick={() => run(onMatchmaking)} {...intent('matchmaking')} aria-label={`${onlineLabel}. Find a random opponent.`}><span className="presence-dot" aria-hidden="true"/><span className="live-presence-copy">{onlineLabel}</span></button>
        <button className="nav-account-button" onClick={() => run(onAccount)} {...intent('account')} aria-label="Open player account" aria-current={screen === 'account' ? 'page' : undefined}><span aria-hidden="true">♙</span><span className="nav-control-label">Account</span></button>
        <button ref={displayButtonRef} className="display-toggle" onClick={() => setDisplayOpen(value => !value)} aria-expanded={displayOpen} aria-controls="qqurz-display-menu" aria-label="Display and accessibility settings"><span aria-hidden="true">Aa</span><span className="nav-control-label">Display</span></button>
      </div>

      <div className="mobile-nav-actions" aria-label="Quick actions">
        <IconButton className="mobile-presence-button" size="sm" onClick={() => run(onMatchmaking)} {...intent('matchmaking')} aria-label={`${onlineLabel}. Find a random opponent.`}><span className="presence-dot" /></IconButton>
        <IconButton className="mobile-account-button" size="sm" onClick={() => run(onAccount)} {...intent('account')} aria-label="Open player account">♙</IconButton>
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
      <aside className="chess-drawer" role="dialog" aria-modal="true" aria-label="QQURZ menu" onPointerDown={event => event.stopPropagation()}>
        <div className="drawer-head">
          <button className="qqurz-wordmark" onClick={() => run(onHome)}><img className="wordmark-mark" src={BRAND_MARK} alt="" aria-hidden="true" /><span className="wordmark-copy"><b>QQURZ</b><small>Chess960</small></span></button>
          <button className="drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><UiIcon name="close" /></button>
        </div>
        <nav className="drawer-links" aria-label="Chess menu" onKeyDown={moveFocus}>
          <button onClick={() => run(onTournaments)} {...intent('tournaments')}><span aria-hidden="true">♛</span><div><b>Play a tournament</b><small>QQURZ competitive events</small></div></button>
          <button onClick={() => run(onFriends)} {...intent('online')}><span aria-hidden="true">♘</span><div><b>Play a friend</b><small>Create or join a private room</small></div></button>
          <button onClick={() => run(onSameDevice)} {...intent('local')}><span aria-hidden="true">♟</span><div><b>Same device</b><small>Two players, one board</small></div></button>
          <button onClick={() => run(onPremium3D)} {...intent('3d')}><span aria-hidden="true">♜</span><div><b>Premium 3D</b><small>Physical board experience</small></div></button>
          <button onClick={() => run(onAccount)} {...intent('account')}><span aria-hidden="true">♙</span><div><b>Account</b><small>Identity, ratings and settings</small></div></button>
          <button className="drawer-ai-choice" onClick={() => run(onAI)} {...intent('local')}><span aria-hidden="true">♞</span><div><b>Practice with AI</b><small>Stockfish training only</small></div></button>
        </nav>
        <div className="drawer-live-match">
          <div><span className="presence-dot" aria-hidden="true"/><b>{onlineLabel}</b><small>Players seen on QQURZ recently</small></div>
          <button onClick={() => run(onMatchmaking)} {...intent('matchmaking')}>Find an opponent</button>
        </div>
        <div className="drawer-settings" aria-label="Preferences and settings">
          <button onClick={onToggleTheme}><span aria-hidden="true"><UiIcon name="theme" /></span><div><b>App theme</b><small>{theme === 'dark' ? 'Dark' : 'Light'}</small></div></button>
          <button onClick={onCycleBoardAppearance}><span aria-hidden="true"><UiIcon name="board" /></span><div><b>Board</b><small>{boardAppearanceLabel(boardAppearance)}</small></div></button>
          <button onClick={() => onSoundChange(!soundOn)}><span aria-hidden="true"><UiIcon name={soundOn ? 'sound' : 'muted'} /></span><div><b>Sound</b><small>{soundOn ? 'On' : 'Off'}</small></div></button>
          <button onClick={cycleTextSize}><span aria-hidden="true">Aa</span><div><b>Text size</b><small>{fontScaleLabel(preferences.fontScale)}</small></div></button>
          <button onClick={() => { setMenuOpen(false); setDisplayOpen(true); }}><span aria-hidden="true"><UiIcon name="accessibility" /></span><div><b>Accessibility</b><small>Contrast, motion, coordinates & feedback</small></div></button>
        </div>
      </aside>
    </div>}
  </>;
}
