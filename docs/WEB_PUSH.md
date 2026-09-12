# QQURZ Web Push

QQURZ Web Push is a secondary delivery channel for the server-backed in-app notification inbox. The inbox is the durable source of notification history; a push-service failure must never roll back or suppress an in-app notification.

## Player behavior

Web Push is opt-in per browser/device. QQURZ does not call `Notification.requestPermission()` on page load. Permission is requested only after the signed-in player presses **Enable on this device** in the notification center.

On iPhone and iPad, the QQURZ web app must be added to the Home Screen and opened in standalone mode before the enable action is offered. In-app notifications remain available regardless of Web Push support or permission.

Disabling Web Push removes the current browser subscription from the QQURZ notification registry and unsubscribes it locally. It does not disable in-app notification preferences.

## Delivery

Persistent notification events are written to `NotificationRegistry` first. A successful new inbox row can then be delivered through Web Push to up to 10 subscribed devices for that account. Duplicate inbox emits are not pushed again.

Background push currently applies to:

- tournament starting
- round ready
- friend challenge
- color-bid result/refund
- payout
- account/security events

Opponent-connected and reconnect/recovered warnings remain live in-app signals and are intentionally not background pushes.

The push service worker is `public/qqurz-push-sw.js`. It handles only `push` and `notificationclick`; it does not intercept fetches or implement an offline cache.

## Subscription privacy

Push subscription endpoints are capability URLs. QQURZ stores the endpoint and its `p256dh`/`auth` keys only in server-side Durable Object storage and never returns them from the public notification API.

If the same browser subscription is uploaded after a different QQURZ account signs in, ownership is reassigned to the current account and removed from the previous account index. Expired endpoints returning HTTP 404 or 410 are removed automatically.

## VAPID keys

The Worker uses:

- `WEB_PUSH_VAPID_PUBLIC_KEY` — Cloudflare Worker secret
- `WEB_PUSH_VAPID_PRIVATE_KEY` — Cloudflare Worker secret
- `WEB_PUSH_VAPID_SUBJECT` — non-secret Wrangler var (`https://qqurzchess.com`)

The deployment workflow checks existing Worker secret names. If both VAPID secrets are absent, it generates one pair with `web-push-neo`, writes each key directly to Cloudflare through `wrangler secret put`, deletes the temporary files, and never prints the key values.

If both secrets already exist, deployment preserves them. If only one exists, deployment fails closed rather than generating a mismatched pair. Do not rotate the pair casually: existing browser subscriptions were created against its public key.

## Troubleshooting

If Web Push shows **Unavailable**, verify both VAPID Worker secrets exist and that the Worker deployed successfully. If a browser shows **Blocked**, notification permission must be changed in browser/device settings; QQURZ cannot override a denied permission. On iOS, verify the site is launched from its Home Screen icon rather than an ordinary Safari tab.
