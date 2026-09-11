import type { RoomSeat, ServerEvent } from './types';

const configuredBase = (import.meta.env.VITE_MULTIPLAYER_API as string | undefined)?.trim().replace(/\/$/, '');

export const MULTIPLAYER_API = configuredBase ?? '';
export const multiplayerConfigured = Boolean(MULTIPLAYER_API);

export type PresenceSnapshot = {
  presenceId?: string;
  onlinePlayers: number;
};

export type MatchmakingSnapshot = {
  ticket: string;
  status: 'waiting' | 'matched';
  seat: RoomSeat | null;
  opponent: string | null;
  onlinePlayers: number;
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!MULTIPLAYER_API) {
    throw new Error('The live multiplayer server has not been connected yet.');
  }

  const response = await fetch(`${MULTIPLAYER_API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Server returned ${response.status}.`);
  return payload;
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

export async function pingPresence(name: string, presenceId: string): Promise<PresenceSnapshot> {
  return requestJson<PresenceSnapshot>('/presence/ping', {
    method: 'POST',
    body: JSON.stringify({ name, presenceId }),
  });
}

export async function loadPresence(): Promise<PresenceSnapshot> {
  return requestJson<PresenceSnapshot>('/presence');
}

export async function enqueueMatch(name: string, presenceId: string): Promise<MatchmakingSnapshot> {
  return requestJson<MatchmakingSnapshot>('/matchmaking/enqueue', {
    method: 'POST',
    body: JSON.stringify({ name, presenceId }),
  });
}

export async function loadMatch(ticket: string): Promise<MatchmakingSnapshot> {
  return requestJson<MatchmakingSnapshot>(`/matchmaking/status?ticket=${encodeURIComponent(ticket)}`);
}

export async function cancelMatch(ticket: string): Promise<{ cancelled: boolean; onlinePlayers: number }> {
  return requestJson<{ cancelled: boolean; onlinePlayers: number }>('/matchmaking/cancel', {
    method: 'POST',
    body: JSON.stringify({ ticket }),
  });
}

export async function createRoom(name: string): Promise<RoomSeat> {
  return requestJson<RoomSeat>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ name }),
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
      onEvent(payload);
    } catch {
      onEvent({ type: 'error', message: 'The multiplayer server sent an unreadable update.' });
    }
  });

  return socket;
}
