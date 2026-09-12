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

export type WebPushState = {
  supported: boolean;
  configured: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  ios: boolean;
  standalone: boolean;
  serverSubscriptions: number;
  reason: string | null;
};

type WebPushConfig = {
  configured: boolean;
  publicKey: string | null;
  subscriptions: number;
};

const WEB_PUSH_ENABLED_KEY = 'qqurz:web-push-enabled';

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

function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

function pushPreferenceEnabled(): boolean {
  try { return localStorage.getItem(WEB_PUSH_ENABLED_KEY) === '1'; } catch { return false; }
}

function setPushPreference(enabled: boolean): void {
  try { localStorage.setItem(WEB_PUSH_ENABLED_KEY, enabled ? '1' : '0'); } catch { /* storage is optional */ }
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function pushConfig(): Promise<WebPushConfig> {
  return requestJson<WebPushConfig>('/notifications/push/config');
}

function serviceWorkerUrl(): string {
  return new URL('./qqurz-push-sw.js', document.baseURI).toString();
}

async function pushRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(serviceWorkerUrl());
  await navigator.serviceWorker.ready;
  return registration;
}

async function uploadPushSubscription(subscription: PushSubscription): Promise<void> {
  await requestJson('/notifications/push/subscription', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
}

function unsupportedState(reason: string): WebPushState {
  return {
    supported: false,
    configured: false,
    permission: 'unsupported',
    subscribed: false,
    ios: isIosDevice(),
    standalone: isStandalone(),
    serverSubscriptions: 0,
    reason,
  };
}

export async function inspectWebPush(): Promise<WebPushState> {
  if (!pushSupported()) return unsupportedState('This browser does not support Web Push.');
  const ios = isIosDevice();
  const standalone = isStandalone();
  let config: WebPushConfig;
  try { config = await pushConfig(); }
  catch (error) {
    return {
      supported: true,
      configured: false,
      permission: Notification.permission,
      subscribed: false,
      ios,
      standalone,
      serverSubscriptions: 0,
      reason: error instanceof Error ? error.message : 'Web Push configuration is unavailable.',
    };
  }
  if (!config.configured || !config.publicKey) {
    return { supported: true, configured: false, permission: Notification.permission, subscribed: false, ios, standalone, serverSubscriptions: config.subscriptions ?? 0, reason: 'Web Push is not configured on the server.' };
  }
  if (ios && !standalone) {
    return { supported: true, configured: true, permission: Notification.permission, subscribed: false, ios, standalone, serverSubscriptions: config.subscriptions ?? 0, reason: 'On iPhone and iPad, add QQURZ to the Home Screen before enabling push.' };
  }

  let subscribed = false;
  if (Notification.permission === 'granted') {
    try {
      const registration = await navigator.serviceWorker.getRegistration(serviceWorkerUrl());
      subscribed = Boolean(await registration?.pushManager.getSubscription());
    } catch { subscribed = false; }
  }
  return {
    supported: true,
    configured: true,
    permission: Notification.permission,
    subscribed,
    ios,
    standalone,
    serverSubscriptions: config.subscriptions ?? 0,
    reason: Notification.permission === 'denied' ? 'Push is blocked in browser notification settings.' : null,
  };
}

export async function syncExistingWebPushSubscription(): Promise<WebPushState> {
  if (!accountToken() || !pushSupported() || !pushPreferenceEnabled() || Notification.permission !== 'granted') return inspectWebPush();
  const config = await pushConfig();
  if (!config.configured || !config.publicKey) return inspectWebPush();
  if (isIosDevice() && !isStandalone()) return inspectWebPush();

  const registration = await pushRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey),
    });
  }
  await uploadPushSubscription(subscription);
  return inspectWebPush();
}

export async function enableWebPush(): Promise<WebPushState> {
  if (!accountToken()) throw new Error('Sign in before enabling Web Push.');
  if (!pushSupported()) throw new Error('This browser does not support Web Push.');
  if (isIosDevice() && !isStandalone()) throw new Error('On iPhone and iPad, add QQURZ to the Home Screen first, then enable push from the installed app.');

  const config = await pushConfig();
  if (!config.configured || !config.publicKey) throw new Error('Web Push is not configured on the QQURZ server yet.');
  const registration = await pushRegistration();
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    setPushPreference(false);
    if (permission === 'denied') throw new Error('Push permission was blocked. You can change it in your browser or device notification settings.');
    throw new Error('Push permission was not granted.');
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey),
    });
  }
  await uploadPushSubscription(subscription);
  setPushPreference(true);
  return inspectWebPush();
}

export async function disableWebPush(): Promise<WebPushState> {
  setPushPreference(false);
  if (!pushSupported()) return inspectWebPush();
  const registration = await navigator.serviceWorker.getRegistration(serviceWorkerUrl());
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    try {
      await requestJson('/notifications/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    } finally {
      await subscription.unsubscribe().catch(() => false);
    }
  }
  return inspectWebPush();
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
