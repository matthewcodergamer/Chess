import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import AppNavigation from './accessibility/AppNavigation';
import { getPresenceId, loadOnlinePlayers, multiplayerConfigured, pingPresence, type OnlinePlayer } from './multiplayer/client';
import type { RoomSeat } from './multiplayer/types';
import { setSoundEnabled, soundEnabled } from './ui/sound';
import { ProfilePageSkeleton, TournamentPageSkeleton } from './ui/Skeletons';
import HomeDashboard from './ui/HomeDashboard';
import StateNotice from './ui/StateNotice';
import FirstRunOnboarding from './onboarding/FirstRunOnboarding';
import {
  hasCompletedOnboarding,
  loadBoardAppearance,
  saveBoardAppearance,
  type BoardAppearance,
} from './onboarding/preferences';

const loadLocalGame = () => import('./LocalGame');
const loadOnlineArena = () => import('./multiplayer/OnlineArena');
const loadRandomMatchmaking = () => import('./multiplayer/RandomMatchmaking');
const loadTournamentHub = () => import('./tournaments/TournamentHub');
const loadPremium3DGate = () => import('./premium/Premium3DGate');
const loadProfileHub = () => import('./profile/ProfileHub');
const loadFairPlayPrompt = () => import('./fairPlay/FairPlayPrompt');
const loadFairPlayRoomTools = () => import('./fairPlay/FairPlayRoomTools');

const LocalGame = lazy(loadLocalGame);
const OnlineArena = lazy(loadOnlineArena);
const RandomMatchmaking = lazy(loadRandomMatchmaking);
const TournamentHub = lazy(loadTournamentHub);
const Premium3DGate = lazy(loadPremium3DGate);
const ProfileHub = lazy(loadProfileHub);
const FairPlayPrompt = lazy(loadFairPlayPrompt);
const FairPlayRoomTools = lazy(loadFairPlayRoomTools);

type Screen = 'home' | 'local' | 'online' | 'matchmaking' | 'tournaments' | '3d' | 'account';
type LocalMode = 'human' | 'ai';
type Theme = 'light' | 'dark';
type NetworkInformation = { saveData?: boolean; effectiveType?: string };

function canPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!connection) return true;
  return !connection.saveData && connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

function hasAccountAction(): boolean {
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get('verify') || params.get('reset'));
}

function initialScreen(): Screen {
  const params = new URLSearchParams(window.location.search);
  if (params.get('verify') || params.get('reset')) return 'account';
  if (params.get('room')) return 'online';
  const checkoutKind = params.get('kind');
  const checkoutState = params.get('checkout');
  if ((checkoutState === 'success' || checkoutState === 'cancel') && (checkoutKind === 'position_bid' || checkoutKind === 'color_bid')) return 'online';
  if ((checkoutState === 'success' || checkoutState === 'cancel') && checkoutKind === 'premium3d') return '3d';
  if ((checkoutState === 'success' || checkoutState === 'cancel') && checkoutKind === 'tournament') return 'tournaments';
  if (checkoutState === 'success') return 'tournaments';
  return 'home';
}

function initialTheme(): Theme {
  const saved = window.localStorage.getItem('qqurz:theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return 'dark';
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

function LoadingView() {
  return (
    <div className="qqurz-loading chess-loading" role="status" aria-live="polite">
      <span className="qqurz-loading-knight" aria-hidden="true">♞</span>
      <strong>Loading</strong>
    </div>
  );
}

export default function AppShell() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [accountAction] = useState(hasAccountAction);
  const [localMode, setLocalMode] = useState<LocalMode>('human');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [boardAppearance, setBoardAppearance] = useState<BoardAppearance>(loadBoardAppearance);
  const [onboardingComplete, setOnboardingComplete] = useState(hasCompletedOnboarding);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [onlineVariant, setOnlineVariant] = useState<'friends' | 'tournament'>('friends');
  const [onlinePlayers, setOnlinePlayers] = useState<number | null>(null);
  const [onlinePlayerList, setOnlinePlayerList] = useState<OnlinePlayer[]>([]);
  const [presenceId] = useState(getPresenceId);
  const [serverUnavailable, setServerUnavailable] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('qqurz:theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.boardTheme = boardAppearance;
    saveBoardAppearance(boardAppearance);
  }, [boardAppearance]);

  const retryPresence = useCallback(async () => {
    if (!onboardingComplete || !multiplayerConfigured) return;
    try {
      const presence = await pingPresence(profileName(), presenceId);
      setOnlinePlayers(presence.onlinePlayers);
      const players = await loadOnlinePlayers();
      setOnlinePlayerList(players.players);
      setServerUnavailable(false);
    } catch {
      setServerUnavailable(true);
    }
  }, [onboardingComplete, presenceId]);

  useEffect(() => {
    if (!onboardingComplete || !multiplayerConfigured) return;
    const onVisibility = () => { if (document.visibilityState === 'visible') void retryPresence(); };
    void retryPresence();
    const timer = window.setInterval(() => void retryPresence(), 20_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onboardingComplete, retryPresence]);

  const prefetchScreen = (next: Screen) => {
    if (!canPrefetch()) return;
    if (next === 'local') void loadLocalGame();
    else if (next === 'online') void Promise.all([loadOnlineArena(), loadFairPlayPrompt(), loadFairPlayRoomTools()]);
    else if (next === 'matchmaking') void Promise.all([loadRandomMatchmaking(), loadFairPlayPrompt()]);
    else if (next === 'tournaments') void Promise.all([loadTournamentHub(), loadFairPlayPrompt()]);
    else if (next === '3d') void loadPremium3DGate();
    else if (next === 'account') void loadProfileHub();
  };

  const intent = (next: Screen) => ({
    onPointerEnter: () => prefetchScreen(next),
    onFocus: () => prefetchScreen(next),
    onPointerDown: () => prefetchScreen(next),
  });

  const goHome = () => {
    const url = new URL(window.location.href);
    ['room', 'checkout', 'kind', 'item', 'session_id', 'color', 'verify', 'reset'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState({}, '', url);
    setScreen('home');
  };

  const openLocal = (mode: LocalMode) => {
    setLocalMode(mode);
    setScreen('local');
  };

  const openFriends = () => {
    setOnlineVariant('friends');
    setScreen('online');
  };

  const openMatchmaking = () => setScreen('matchmaking');

  const applySound = (value: boolean) => {
    setSoundOn(value);
    setSoundEnabled(value);
  };

  if (!onboardingComplete && !accountAction) {
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
  const roomParam = new URLSearchParams(window.location.search).get('room')?.trim() ?? '';
  const invalidInvite = Boolean(roomParam && !/^[A-Z0-9]{6}$/i.test(roomParam));
  const serverScreen = screen === 'online' || screen === 'matchmaking' || screen === 'tournaments';
  const createFreshRoom = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
    setOnlineVariant('friends');
    setScreen('online');
  };

  return (
    <main className="qqurz-app-v14 qqurz-app-v22 qqurz-app-v24 qqurz-product-system">
      <AppNavigation
        screen={screen}
        onlineVariant={onlineVariant}
        onlineLabel={onlineLabel}
        theme={theme}
        boardAppearance={boardAppearance}
        soundOn={soundOn}
        onSoundChange={applySound}
        onToggleTheme={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
        onCycleBoardAppearance={() => setBoardAppearance(value => value === 'walnut' ? 'tournament' : value === 'tournament' ? 'slate' : 'walnut')}
        onHome={goHome}
        onTournaments={() => setScreen('tournaments')}
        onFriends={openFriends}
        onSameDevice={() => openLocal('human')}
        onAI={() => openLocal('ai')}
        onMatchmaking={openMatchmaking}
        onPremium3D={() => setScreen('3d')}
        onAccount={() => setScreen('account')}
        intent={intent}
      />

      <div id="qqurz-main-content" className="qqurz-main-content" tabIndex={-1}>
        {serverUnavailable && serverScreen && !invalidInvite && (
          <div className="qqurz-content-page qqurz-service-status-page">
            <StateNotice
              tone="warning"
              className="service-unavailable-notice compact"
              icon="↻"
              eyebrow="LIVE SERVICES"
              title="Online services are temporarily unavailable"
              body={<p>We can’t reach the live server right now. Your local chess games are still available.</p>}
              actions={[
                { label: 'Retry server', onClick: () => void retryPresence(), primary: true },
                { label: 'Play local instead', onClick: () => openLocal('human') },
              ]}
            />
          </div>
        )}

        {screen === 'home' && (
          <HomeDashboard
            onlineLabel={onlineLabel}
            onlinePlayers={onlinePlayerList}
            onProfile={() => setScreen('account')}
            onTournament={() => setScreen('tournaments')}
            onFriend={openFriends}
            onSameDevice={() => openLocal('human')}
            onMatchmaking={openMatchmaking}
            onPremium3D={() => setScreen('3d')}
            onAI={() => openLocal('ai')}
          />
        )}

        {screen === 'local' && <Suspense fallback={<LoadingView/>}><div className="qqurz-local-v14"><LocalGame key={localMode} initialMode={localMode}/></div></Suspense>}
        {screen === 'online' && invalidInvite && <div className="qqurz-content-page"><StateNotice tone="warning" icon="↗" eyebrow="ROOM INVITE" title="This invite link isn’t valid" body={<p>QQURZ room codes contain exactly six letters or numbers. This link may be incomplete, expired from sharing, or edited.</p>} detail="You can create a fresh private room and send its new invite instead." actions={[{ label: 'Create a room', onClick: createFreshRoom, primary: true }, { label: 'Back home', onClick: goHome }]} /></div>}
        {screen === 'online' && !invalidInvite && <Suspense fallback={<LoadingView/>}><div className="qqurz-content-page"><FairPlayPrompt/><OnlineArena onClose={goHome} variant={onlineVariant}/><FairPlayRoomTools/></div></Suspense>}
        {screen === 'matchmaking' && <Suspense fallback={<LoadingView/>}><><FairPlayPrompt/><RandomMatchmaking onlinePlayers={onlinePlayers} onOnlinePlayers={setOnlinePlayers} onMatched={(_seat: RoomSeat) => { setOnlineVariant('friends'); setScreen('online'); }} onBack={goHome}/></></Suspense>}
        {screen === 'tournaments' && <Suspense fallback={<TournamentPageSkeleton/>}><div className="qqurz-content-page"><FairPlayPrompt mode="inline"/><TournamentHub onBack={goHome} onPlayOnline={() => { prefetchScreen('online'); setOnlineVariant('tournament'); setScreen('online'); }} onShow3D={() => { prefetchScreen('3d'); setScreen('3d'); }}/></div></Suspense>}
        {screen === '3d' && <Suspense fallback={<LoadingView/>}><Premium3DGate onBack={goHome}/></Suspense>}
        {screen === 'account' && <Suspense fallback={<ProfilePageSkeleton/>}><ProfileHub onBack={goHome}/></Suspense>}
      </div>
    </main>
  );
}
