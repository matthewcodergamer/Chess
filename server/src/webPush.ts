import { sendNotification, type PushSubscription as WebPushSubscription } from 'web-push-neo';
import { resolveAccountSession } from './accounts';
import {
  NotificationRegistry,
  type InAppNotification,
  type NotificationAction,
  type NotificationEnv,
} from './notifications';

export type WebPushEnv = NotificationEnv & {
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
  PUBLIC_SITE_URL?: string;
};

type StoredPushSubscription = {
  id: string;
  accountId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  createdAt: number;
  updatedAt: number;
};

type BrowserPushSubscription = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown } | null;
};

type WebPushErrorShape = { statusCode?: number };

const PUSH_INDEX_PREFIX = 'notifications:push-index:v1:';
const PUSH_ITEM_PREFIX = 'notifications:push-item:v1:';
const PUSH_OWNER_PREFIX = 'notifications:push-owner:v1:';
const MAX_PUSH_SUBSCRIPTIONS = 10;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function clean(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function pushConfigured(env: WebPushEnv): boolean {
  return Boolean(
    clean(env.WEB_PUSH_VAPID_PUBLIC_KEY, 512)
    && clean(env.WEB_PUSH_VAPID_PRIVATE_KEY, 1024)
    && clean(env.WEB_PUSH_VAPID_SUBJECT, 512),
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

async function endpointId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return base64Url(new Uint8Array(digest)).slice(0, 36);
}

function validSubscription(input: BrowserPushSubscription): { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } } | null {
  const endpoint = clean(input.endpoint, 2048);
  if (!endpoint) return null;
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  const p256dh = clean(input.keys?.p256dh, 256);
  const auth = clean(input.keys?.auth, 128);
  if (!p256dh || !auth) return null;
  const expirationTime = input.expirationTime === null || input.expirationTime === undefined
    ? null
    : Number(input.expirationTime);
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0)) return null;
  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

function notificationUrl(env: WebPushEnv, action: NotificationAction): string {
  const fallback = clean(env.PUBLIC_SITE_URL, 600) || 'https://qqurzchess.com';
  let url: URL;
  try { url = new URL(fallback); } catch { url = new URL('https://qqurzchess.com'); }
  if (action?.type === 'room') url.searchParams.set('room', action.roomCode.toUpperCase());
  return url.toString();
}

function pushTopic(notification: InAppNotification): string {
  return `qqurz-${notification.kind}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);
}

function toWebPushSubscription(record: StoredPushSubscription): WebPushSubscription {
  return {
    endpoint: record.endpoint,
    keys: { p256dh: record.keys.p256dh, auth: record.keys.auth },
  };
}

export class WebPushNotificationRegistry extends NotificationRegistry {
  private pushInternals(): { ctx: DurableObjectState; env: WebPushEnv } {
    return this as unknown as { ctx: DurableObjectState; env: WebPushEnv };
  }

  private async removeSubscription(accountId: string, id: string): Promise<void> {
    const ctx = this.pushInternals().ctx;
    const record = await ctx.storage.get<StoredPushSubscription>(`${PUSH_ITEM_PREFIX}${id}`);
    const indexKey = `${PUSH_INDEX_PREFIX}${accountId}`;
    const ids = (await ctx.storage.get<string[]>(indexKey)) ?? [];
    await ctx.storage.put(indexKey, ids.filter(value => value !== id));
    if (record?.accountId === accountId) {
      await ctx.storage.delete(`${PUSH_ITEM_PREFIX}${id}`);
      const ownerKey = `${PUSH_OWNER_PREFIX}${id}`;
      if (await ctx.storage.get<string>(ownerKey) === accountId) await ctx.storage.delete(ownerKey);
    }
  }

  private async subscribe(body: Record<string, unknown>): Promise<Response> {
    const accountId = clean(body.accountId, 80);
    const parsed = validSubscription((body.subscription ?? {}) as BrowserPushSubscription);
    if (!accountId || !parsed) return json({ error: 'Invalid Web Push subscription.' }, 400);

    const ctx = this.pushInternals().ctx;
    const id = await endpointId(parsed.endpoint);
    const ownerKey = `${PUSH_OWNER_PREFIX}${id}`;
    const previousOwner = await ctx.storage.get<string>(ownerKey);
    if (previousOwner && previousOwner !== accountId) await this.removeSubscription(previousOwner, id);

    const now = Date.now();
    const old = await ctx.storage.get<StoredPushSubscription>(`${PUSH_ITEM_PREFIX}${id}`);
    const record: StoredPushSubscription = {
      id,
      accountId,
      endpoint: parsed.endpoint,
      expirationTime: parsed.expirationTime,
      keys: parsed.keys,
      createdAt: old?.accountId === accountId ? old.createdAt : now,
      updatedAt: now,
    };
    const indexKey = `${PUSH_INDEX_PREFIX}${accountId}`;
    const existing = (await ctx.storage.get<string[]>(indexKey)) ?? [];
    const next = [id, ...existing.filter(value => value !== id)].slice(0, MAX_PUSH_SUBSCRIPTIONS);
    const evicted = existing.filter(value => !next.includes(value));

    await ctx.storage.put({
      [indexKey]: next,
      [`${PUSH_ITEM_PREFIX}${id}`]: record,
      [ownerKey]: accountId,
    });
    for (const staleId of evicted) await this.removeSubscription(accountId, staleId);
    return json({ ok: true, subscriptionId: id, subscriptions: next.length }, old ? 200 : 201);
  }

  private async unsubscribe(body: Record<string, unknown>): Promise<Response> {
    const accountId = clean(body.accountId, 80);
    const endpoint = clean(body.endpoint, 2048);
    if (!accountId || !endpoint) return json({ error: 'Invalid Web Push unsubscribe request.' }, 400);
    const id = await endpointId(endpoint);
    const owner = await this.pushInternals().ctx.storage.get<string>(`${PUSH_OWNER_PREFIX}${id}`);
    if (owner === accountId) await this.removeSubscription(accountId, id);
    return json({ ok: true });
  }

  private async status(accountId: string): Promise<Response> {
    const ids = (await this.pushInternals().ctx.storage.get<string[]>(`${PUSH_INDEX_PREFIX}${accountId}`)) ?? [];
    return json({ configured: pushConfigured(this.pushInternals().env), subscriptions: ids.length });
  }

  private async sendSavedNotification(notification: InAppNotification): Promise<void> {
    const { ctx, env } = this.pushInternals();
    if (!pushConfigured(env)) return;
    const ids = (await ctx.storage.get<string[]>(`${PUSH_INDEX_PREFIX}${notification.accountId}`)) ?? [];
    if (!ids.length) return;

    const records = (await Promise.all(ids.map(id => ctx.storage.get<StoredPushSubscription>(`${PUSH_ITEM_PREFIX}${id}`))))
      .filter((item): item is StoredPushSubscription => item !== undefined && item !== null && item.accountId === notification.accountId);
    if (!records.length) return;

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      tag: notification.dedupeKey.slice(0, 64),
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        notificationId: notification.id,
        kind: notification.kind,
        url: notificationUrl(env, notification.action),
      },
    });
    const vapidDetails = {
      subject: clean(env.WEB_PUSH_VAPID_SUBJECT, 512),
      publicKey: clean(env.WEB_PUSH_VAPID_PUBLIC_KEY, 512),
      privateKey: clean(env.WEB_PUSH_VAPID_PRIVATE_KEY, 1024),
    };

    await Promise.allSettled(records.map(async record => {
      try {
        await sendNotification(toWebPushSubscription(record), payload, {
          vapidDetails,
          TTL: notification.kind === 'round_ready' || notification.kind === 'friend_challenge' ? 900 : 86_400,
          urgency: notification.priority === 'normal' ? 'normal' : 'high',
          topic: pushTopic(notification),
          signal: AbortSignal.timeout(8_000),
        });
      } catch (error) {
        const statusCode = Number((error as WebPushErrorShape | null)?.statusCode ?? 0);
        if (statusCode === 404 || statusCode === 410) await this.removeSubscription(notification.accountId, record.id);
      }
    }));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/push/subscribe' && request.method === 'POST') {
      return this.subscribe(await request.json().catch(() => ({})) as Record<string, unknown>);
    }
    if (url.pathname === '/internal/push/unsubscribe' && request.method === 'POST') {
      return this.unsubscribe(await request.json().catch(() => ({})) as Record<string, unknown>);
    }
    if (url.pathname === '/internal/push/status' && request.method === 'GET') {
      return this.status(clean(url.searchParams.get('accountId'), 80));
    }

    const response = await super.fetch(request);
    if (url.pathname === '/internal/emit' && request.method === 'POST' && response.status === 201) {
      const body = await response.clone().json().catch(() => ({})) as { notification?: InAppNotification; duplicate?: boolean };
      if (body.notification && !body.duplicate) this.pushInternals().ctx.waitUntil(this.sendSavedNotification(body.notification));
    }
    return response;
  }
}

function notificationStub(env: NotificationEnv): DurableObjectStub {
  return env.NOTIFICATIONS.get(env.NOTIFICATIONS.idFromName('qqurz-notification-registry-v1'));
}

export async function handleWebPushRequest(request: Request, env: WebPushEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/notifications/push/')) return null;
  const identity = await resolveAccountSession(request, env);
  if (!identity) return json({ error: 'Sign in to manage Web Push.' }, 401);

  if (url.pathname === '/notifications/push/config' && request.method === 'GET') {
    const configured = pushConfigured(env);
    const statusResponse = await notificationStub(env).fetch(new Request(`https://notifications.internal/internal/push/status?accountId=${encodeURIComponent(identity.id)}`));
    const status = await statusResponse.json().catch(() => ({ subscriptions: 0 })) as { subscriptions?: number };
    return json({
      configured,
      publicKey: configured ? clean(env.WEB_PUSH_VAPID_PUBLIC_KEY, 512) : null,
      subscriptions: Math.max(0, Number(status.subscriptions ?? 0)),
    });
  }

  if (url.pathname === '/notifications/push/subscription' && request.method === 'POST') {
    if (!pushConfigured(env)) return json({ error: 'Web Push is not configured on this server.' }, 503);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return notificationStub(env).fetch(new Request('https://notifications.internal/internal/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: identity.id, subscription: body.subscription }),
    }));
  }

  if (url.pathname === '/notifications/push/unsubscribe' && request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return notificationStub(env).fetch(new Request('https://notifications.internal/internal/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: identity.id, endpoint: body.endpoint }),
    }));
  }

  return json({ error: 'Web Push route not found.' }, 404);
}
