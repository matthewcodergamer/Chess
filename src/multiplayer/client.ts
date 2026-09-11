import type { RoomSeat, ServerEvent } from './types';
import type { TimeControl, TournamentTimeTemplateId } from '../../shared/timeControl';
import { accountToken } from '../account/client';

const configuredBase = (import.meta.env.VITE_MULTIPLAYER_API as string | undefined)?.trim().replace(/\/$/, '');

export const MULTIPLAYER_API = configuredBase ?? '';
export const multiplayerConfigured = Boolean(MULTIPLAYER_API);

export type PresenceState = 'online' | 'away' | 'game' | 'offline';
export type PresenceCounts = { online: number; away: number; game: number };
export type RegionPreference = 'nearest' | 'regional' | 'global';
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

export async function createRoom(name: string, timeControl?: TimeControl, tournamentTemplateId?: TournamentTimeTemplateId): Promise<RoomSeat> {
  return requestJson<RoomSeat>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, timeControl, tournamentTemplateId }),
  });
}

export async function joinRoom(code: string, name: string): Promise<RoomSeat> {
  return requestJson<RoomSeat>(`/rooms/${encodeURIComponent(code.toUpperCase())}/join`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function connectRoom(
  seat: RoomSeat,
  onEvent: (event: ServerEvent) => void,
  onStatus: (status: 'connecting' | 'connected' | 'closed' | 'error') => void,
): WebSocket {
  if (!MULTIPLAYER_API) throw new Error('The live multiplayer server has not been connected yet.');

  const wsBase = MULTIPLAYER_API.replace(/^http/i, 'ws');
  const socket = new WebSocket(`${wsBase}/rooms/${encodeURIComponent(seat.code)}/ws?token=${encodeURIComponent(seat.token)}`);
  onStatus('connecting');

  socket.addEventListener('open', () => onStatus('connected'));
  socket.addEventListener('close', () => onStatus('closed'));
  socket.addEventListener('error', () => onStatus('error'));
  socket.addEventListener('message', event => {
    try {
      const payload = JSON.parse(String(event.data)) as ServerEvent;
      if (payload.type === 'time_sync') {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'time_sync_ack', nonce: payload.nonce }));
        return;
      }
      if (payload.type === 'move_ack') return;
      onEvent(payload);
    } catch {
      onEvent({ type: 'error', message: 'The multiplayer server sent an unreadable update.' });
    }
  });

  return socket;
}
