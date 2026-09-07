import type { RoomSeat, ServerEvent } from './types';

const configuredBase = (import.meta.env.VITE_MULTIPLAYER_API as string | undefined)?.trim().replace(/\/$/, '');

export const MULTIPLAYER_API = configuredBase ?? '';
export const multiplayerConfigured = Boolean(MULTIPLAYER_API);

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
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
