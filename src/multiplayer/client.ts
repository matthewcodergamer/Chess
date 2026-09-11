import type { RoomSeat, ServerEvent } from './types';
import type { TimeControl, TournamentTimeTemplateId } from '../../shared/timeControl';
import { accountToken } from '../account/client';

const configuredBase = (import.meta.env.VITE_MULTIPLAYER_API as string | undefined)?.trim().replace(/\/$/, '');

export const MULTIPLAYER_API = configuredBase ?? '';
export const multiplayerConfigured = Boolean(MULTIPLAYER_API);

export type PresenceState = 'online' | 'away' | 'game' | 'offline';
export type PresenceCounts = { online: number; away: number; game: number };
export type RegionPreference = 'nearest' | 'regional' | 'global';
export type RoomConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
export type MatchmakingCriteria = {
  variant: 'chess960';
  ratingRange: number;
  timeControl: TimeControl;
  regionPreference: RegionPreference;
  maxLatencyMs: number;
};

export type PresenceSnapshot = {
  presenceId?: string;
  state?: PresenceState;
  onlinePlayers: number;
  presence?: PresenceCounts;
};

export type MatchmakingSnapshot = {
  ticket: string;
  status: 'waiting' | 'matched';
  seat: RoomSeat | null;
  opponent: string | null;
  opponentRating: number | null;
  rating: number;
  ratingDeviation: number;
  provisional: boolean;
  criteria: MatchmakingCriteria;
  search: {
    waitedMs: number;
    ratingRange: number;
    estimatedLatencyMs: number | null;
  };
  onlinePlayers: number;
  presence?: PresenceCounts;
};

export type RoomConnection = {
  readonly readyState: number;
  send(data: string): void;
  requestSync(): void;
  close(): void;
};

type PresenceIdentity = { name: string; presenceId: string };
let currentPresence: PresenceIdentity | null = null;
let presenceLifecycleInstalled = false;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!MULTIPLAYER_API) {
    throw new Error('The live multiplayer server has not been connected yet.');
  }

  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = accountToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(`${MULTIPLAYER_API}${path}`, {
    ...init,
    headers,
  });

  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Server returned ${response.status}.`);
  return payload;
}

function inferredPresenceState(): PresenceState {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'away';
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('room')) return 'game';
  return 'online';
}

function sendPresence(identity: PresenceIdentity, state: PresenceState, keepalive = false): Promise<PresenceSnapshot> {
  return requestJson<PresenceSnapshot>('/presence/ping', {
    method: 'POST',
    keepalive,
    body: JSON.stringify({ ...identity, state }),
  });
}

function installPresenceLifecycle(): void {
  if (presenceLifecycleInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  presenceLifecycleInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (!currentPresence || !multiplayerConfigured) return;
    const state: PresenceState = document.visibilityState === 'hidden' ? 'away' : inferredPresenceState();
    void sendPresence(currentPresence, state, true).catch(() => undefined);
  });

  window.addEventListener('pagehide', () => {
    if (!currentPresence || !multiplayerConfigured) return;
    void sendPresence(currentPresence, 'offline', true).catch(() => undefined);
  });
}

export function getPresenceId(): string {
  const key = 'qqurz:presence-id';
  try {
    const existing = localStorage.getItem(key);
    if (existing && existing.length >= 8) return existing;
    const next = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replaceAll('-', '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, next);
    return next;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

export async function pingPresence(name: string, presenceId: string, state?: PresenceState, keepalive = false): Promise<PresenceSnapshot> {
  currentPresence = { name, presenceId };
  installPresenceLifecycle();
  return sendPresence(currentPresence, state ?? inferredPresenceState(), keepalive);
}

export async function loadPresence(): Promise<PresenceSnapshot> {
  return requestJson<PresenceSnapshot>('/presence');
}

export async function enqueueMatch(name: string, presenceId: string, criteria: MatchmakingCriteria): Promise<MatchmakingSnapshot> {
  return requestJson<MatchmakingSnapshot>('/matchmaking/enqueue', {
    method: 'POST',
    body: JSON.stringify({ name, presenceId, ...criteria }),
  });
}

export async function loadMatch(ticket: string): Promise<MatchmakingSnapshot> {
  return requestJson<MatchmakingSnapshot>(`/matchmaking/status?ticket=${encodeURIComponent(ticket)}`);
}

export async function cancelMatch(ticket: string): Promise<{ cancelled: boolean; onlinePlayers: number; presence?: PresenceCounts }> {
  return requestJson<{ cancelled: boolean; onlinePlayers: number; presence?: PresenceCounts }>('/matchmaking/cancel', {
    method: 'POST',
    body: JSON.stringify({ ticket }),
  });
}

function selectedTournamentId(tournamentTemplateId?: TournamentTimeTemplateId): string | undefined {
  if (!tournamentTemplateId || typeof sessionStorage === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem('qqurz:selected-tournament');
    const selected = raw ? JSON.parse(raw) as { id?: string; timeControlTemplateId?: TournamentTimeTemplateId } : null;
    const id = selected?.id?.trim();
    if (selected?.timeControlTemplateId !== tournamentTemplateId || !id || !/^knockout-\d+-\d+$/.test(id)) return undefined;
    return id;
  } catch { return undefined; }
}

export async function createRoom(name: string, timeControl?: TimeControl, tournamentTemplateId?: TournamentTimeTemplateId): Promise<RoomSeat> {
  return requestJson<RoomSeat>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, timeControl, tournamentTemplateId, tournamentId: selectedTournamentId(tournamentTemplateId) }),
  });
}

export async function joinRoom(code: string, name: string): Promise<RoomSeat> {
  return requestJson<RoomSeat>(`/rooms/${encodeURIComponent(code.toUpperCase())}/join`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

const RECONNECT_DELAYS_MS = [300, 650, 1200, 2200, 3500, 5000, 7000, 9000] as const;
const FOREGROUND_SYNC_TIMEOUT_MS = 1600;

export function connectRoom(
  seat: RoomSeat,
  onEvent: (event: ServerEvent) => void,
  onStatus: (status: RoomConnectionStatus) => void,
): RoomConnection {
  if (!MULTIPLAYER_API) throw new Error('The live multiplayer server has not been connected yet.');

  const wsBase = MULTIPLAYER_API.replace(/^http/i, 'ws');
  const url = `${wsBase}/rooms/${encodeURIComponent(seat.code)}/ws?token=${encodeURIComponent(seat.token)}`;
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
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const delay = immediate ? 0 : RECONNECT_DELAYS_MS[Math.min(retryAttempt, RECONNECT_DELAYS_MS.length - 1)];
    if (!immediate) retryAttempt += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      openSocket(true);
    }, delay);
  };

  const handlePayload = (raw: unknown, current: WebSocket) => {
    try {
      const payload = JSON.parse(String(raw)) as ServerEvent;
      if (payload.type === 'time_sync') {
        if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'time_sync_ack', nonce: payload.nonce }));
        return;
      }
      if (payload.type === 'move_ack') return;
      if (payload.type === 'snapshot') clearSyncTimeout();
      onEvent(payload);
    } catch {
      onEvent({ type: 'error', message: 'The multiplayer server sent an unreadable update.' });
    }
  };

  const openSocket = (isReconnect: boolean) => {
    if (stopped) return;
    clearRetry();
    clearSyncTimeout();
    const currentGeneration = ++generation;
    if (isReconnect) emitStatus('reconnecting');
    else emitStatus('connecting');

    let next: WebSocket;
    try { next = new WebSocket(url); }
    catch {
      emitStatus('error');
      scheduleReconnect();
      return;
    }
    socket = next;

    next.addEventListener('open', () => {
      if (stopped || currentGeneration !== generation || socket !== next) return;
      retryAttempt = 0;
      emitStatus('connected');
    });
    next.addEventListener('message', event => {
      if (stopped || currentGeneration !== generation || socket !== next) return;
      handlePayload(event.data, next);
    });
    next.addEventListener('close', () => {
      if (currentGeneration !== generation || socket !== next) return;
      socket = null;
      if (stopped) {
        emitStatus('closed');
        return;
      }
      scheduleReconnect();
    });
    next.addEventListener('error', () => {
      if (stopped || currentGeneration !== generation || socket !== next) return;
      emitStatus('reconnecting');
      try { next.close(); } catch { scheduleReconnect(); }
    });
  };

  const requestSync = () => {
    if (stopped) return;
    const current = socket;
    if (!current || current.readyState !== WebSocket.OPEN) {
      scheduleReconnect(true);
      return;
    }
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
  const onVisibility = () => {
    if (document.visibilityState === 'visible') requestSync();
  };
  const onPageShow = () => requestSync();
  const onOffline = () => {
    clearRetry();
    clearSyncTimeout();
    if (!stopped) emitStatus('reconnecting');
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);

  onStatus('connecting');
  openSocket(false);

  return {
    get readyState() { return socket?.readyState ?? WebSocket.CLOSED; },
    send(data: string) {
      if (socket?.readyState !== WebSocket.OPEN) return;
      try { socket.send(data); } catch { scheduleReconnect(true); }
    },
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
      try { current?.close(1000, 'room view closed'); } catch { /* already gone */ }
      emitStatus('closed');
    },
  };
}
