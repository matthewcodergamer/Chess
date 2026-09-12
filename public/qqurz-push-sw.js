/* QQURZ Web Push worker: push-only, no fetch interception or offline cache. */
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || 'You have a new QQURZ notification.' }; }

  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'QQURZ Chess';
  const body = typeof payload.body === 'string' ? payload.body : 'You have a new QQURZ notification.';
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const options = {
    body,
    tag: typeof payload.tag === 'string' ? payload.tag : undefined,
    icon: typeof payload.icon === 'string' ? payload.icon : './favicon.svg',
    badge: typeof payload.badge === 'string' ? payload.badge : './favicon.svg',
    data,
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = typeof event.notification.data?.url === 'string' && event.notification.data.url
    ? event.notification.data.url
    : new URL('./', self.registration.scope).toString();

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let targetUrl;
    try { targetUrl = new URL(target); } catch { targetUrl = new URL('./', self.registration.scope); }

    for (const client of windows) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== targetUrl.origin) continue;
        if ('navigate' in client && client.url !== targetUrl.toString()) await client.navigate(targetUrl.toString());
        if ('focus' in client) return client.focus();
      } catch { /* try the next controlled window */ }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl.toString());
    return undefined;
  })());
});
