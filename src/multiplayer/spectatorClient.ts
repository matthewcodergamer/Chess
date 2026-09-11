import { MULTIPLAYER_API, type RoomConnectionStatus } from './client';
import type { ServerEvent } from './types';

export type SpectatorConnection = {
  requestSync(): void;
  close(): void;
};

const RECONNECT_DELAYS_MS = [300, 650, 1200, 2200, 3500, 5000, 7000, 9000] as const;
const FOREGROUND_SYNC_TIMEOUT_MS = 1600;

/**
 * Read-only realtime transport for spectators.
 *
 * Deliberately exposes no send() method. The only client-originated frame is
 * sync_request, which asks the room for a fresh canonical snapshot after a
 * reconnect/background resume. Competitive actions stay in player transport.
 */
export function connectSpectatorRoom(
  roomCode: string,
  onEvent: (event: ServerEvent) => void,
  onStatus: (status: RoomConnectionStatus) => void,
): SpectatorConnection {
  if (!MULTIPLAYER_API) throw new Error('The live multiplayer server has not been connected yet.');

  const wsBase = MULTIPLAYER_API.replace(/^http/i, 'ws');
  const url = `${wsBase}/rooms/${encodeURIComponent(roomCode.toUpperCase())}/spectate`;
  let socket: WebSocket | null = null;
  let stopped = false;
  let retryTimer: number | null = null;
  let syncTimer: number | null = null;
  let retryAttempt = 0;
  let generation = 0;
  let status: RoomConnectionStatus = 'connecting';

  const emitStatus = (next: RoomConnectionStatus) => {
    if (status === next) return;
    status = next;
    onStatus(next);
  };
  const clearRetry = () => {
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
  };
  const clearSyncTimeout = () => {
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = null;
  };

  const scheduleReconnect = (immediate = false) => {
    if (stopped) return;
    clearRetry();
    clearSyncTimeout();
    emitStatus('reconnecting');
    if (navigator.onLine === false) return;
    const delay = immediate ? 0 : RECONNECT_DELAYS_MS[Math.min(retryAttempt, RECONNECT_DELAYS_MS.length - 1)];
    if (!immediate) retryAttempt += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      openSocket(true);
    }, delay);
  };

  const openSocket = (reconnecting: boolean) => {
    if (stopped) return;
    clearRetry();
    clearSyncTimeout();
    const currentGeneration = ++generation;
    emitStatus(reconnecting ? 'reconnecting' : 'connecting');
    let next: WebSocket;
    try { next = new WebSocket(url); }
    catch { scheduleReconnect(); return; }
    socket = next;

    next.addEventListener('open', () => {
      if (stopped || socket !== next || generation !== currentGeneration) return;
      retryAttempt = 0;
      emitStatus('connected');
    });
    next.addEventListener('message', event => {
      if (stopped || socket !== next || generation !== currentGeneration) return;
      try {
        const payload = JSON.parse(String(event.data)) as ServerEvent;
        if (payload.type === 'snapshot') clearSyncTimeout();
        onEvent(payload);
      } catch {
        onEvent({ type: 'error', message: 'The spectator feed sent an unreadable update.' });
      }
    });
    next.addEventListener('close', () => {
      if (socket !== next || generation !== currentGeneration) return;
      socket = null;
      if (stopped) return emitStatus('closed');
      scheduleReconnect();
    });
    next.addEventListener('error', () => {
      if (stopped || socket !== next || generation !== currentGeneration) return;
      emitStatus('reconnecting');
      try { next.close(); } catch { scheduleReconnect(); }
    });
  };

  const requestSync = () => {
    if (stopped) return;
    const current = socket;
    if (!current || current.readyState !== WebSocket.OPEN) return scheduleReconnect(true);
    clearSyncTimeout();
    try { current.send(JSON.stringify({ type: 'sync_request' })); }
    catch {
      try { current.close(); } catch { scheduleReconnect(true); }
      return;
    }
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      if (stopped || socket !== current) return;
      emitStatus('reconnecting');
      try { current.close(); } catch { scheduleReconnect(true); }
    }, FOREGROUND_SYNC_TIMEOUT_MS);
  };

  const onOnline = () => scheduleReconnect(true);
  const onOffline = () => {
    clearRetry();
    clearSyncTimeout();
    if (!stopped) emitStatus('reconnecting');
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') requestSync();
  };
  const onPageShow = () => requestSync();

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  onStatus('connecting');
  openSocket(false);

  return {
    requestSync,
    close() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      clearRetry();
      clearSyncTimeout();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
      const current = socket;
      socket = null;
      try { current?.close(1000, 'spectator view closed'); } catch { /* already gone */ }
      emitStatus('closed');
    },
  };
}
