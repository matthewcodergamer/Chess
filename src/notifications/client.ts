import { ACCOUNT_API, accountToken } from '../account/client';

export type NotificationKind =
  | 'tournament_starting'
  | 'round_ready'
  | 'friend_challenge'
  | 'color_bid_result'
  | 'color_bid_refund'
  | 'payout'
  | 'security';

export type NotificationAction =
  | { type: 'room'; roomCode: string }
  | { type: 'tournament'; tournamentId: string }
  | { type: 'account' }
  | null;

export type InAppNotification = {
  id: string;
  accountId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
  priority: 'normal' | 'important' | 'security';
  action: NotificationAction;
  dedupeKey: string;
  metadata: Record<string, string>;
};

export type NotificationInbox = {
  notifications: InAppNotification[];
  unread: number;
  serverNow: number;
};

export type LocalNotification = {
  id: string;
  kind: 'opponent_connected' | 'reconnect_warning' | 'reconnected';
  title: string;
  body: string;
  createdAt: number;
  priority: 'normal' | 'important';
  roomCode?: string;
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!ACCOUNT_API) throw new Error('The QQURZ notification server is not connected.');
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = accountToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${ACCOUNT_API}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Notification server returned ${response.status}.`);
  return payload;
}

export async function loadNotifications(): Promise<NotificationInbox> {
  return requestJson<NotificationInbox>('/notifications');
}

export async function markNotificationRead(id: string): Promise<InAppNotification> {
  return (await requestJson<{ notification: InAppNotification }>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' })).notification;
}

export async function markAllNotificationsRead(): Promise<void> {
  await requestJson('/notifications/read-all', { method: 'POST', body: '{}' });
}

export async function sendFriendChallenge(username: string, roomCode: string): Promise<{ ok: boolean; delivered?: boolean; target?: { username: string; displayName: string }; reason?: string }> {
  return requestJson('/notifications/challenge', {
    method: 'POST',
    body: JSON.stringify({ username, roomCode }),
  });
}

export function emitLocalNotification(input: Omit<LocalNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): void {
  if (typeof window === 'undefined') return;
  const detail: LocalNotification = {
    ...input,
    id: input.id ?? `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    createdAt: input.createdAt ?? Date.now(),
  };
  window.dispatchEvent(new CustomEvent<LocalNotification>('qqurz:local-notification', { detail }));
}
