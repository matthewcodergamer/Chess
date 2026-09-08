# QQURZ Chess realtime + payments server

Authoritative Chess960 room server for players on different networks. It runs on Cloudflare Workers + Durable Objects and also owns the QQURZ tournament catalog and Stripe Checkout creation/verification.

## What the server owns

- private six-character room codes and seat tokens
- white/black seats and presence
- Chess960 pattern generation
- server-side legal move validation with `chessops`
- shared two-minute strategy phase
- authoritative 10-minute clocks and time forfeits
- check/checkmate/draw results
- synchronized WebSocket snapshots
- official QQURZ tournament catalog with configurable seat counts
- Stripe Checkout Sessions for tournament entries and the $4.99 Premium 3D pass
- server-side Checkout Session verification

The browser is never trusted to decide whether a chess move is legal or whether a Stripe Checkout Session is paid.

## Deploy multiplayer

```bash
cd server
npm install
npm run check
npx wrangler login
npm run deploy
```

After deployment, set the frontend Actions variable:

```text
VITE_MULTIPLAYER_API=https://YOUR-WORKER.workers.dev
```

For production, prefer a custom Worker domain such as `https://api.qqurzchess.com`.

## Stripe test mode

The committed configuration intentionally stays in test mode:

```text
PAYMENTS_MODE=test
PREMIUM_3D_PRICE_CENTS=499
```

Store the Stripe secret as a Cloudflare Worker **secret**, never in source control:

```bash
cd server
npx wrangler secret put STRIPE_SECRET_KEY
```

For test mode, provide an `sk_test_...` key. Then deploy the Worker again. The frontend will enable Stripe-hosted test Checkout and server-side verification.

## Switching the Premium 3D pass to real payments

The backend supports live Stripe Checkout. When QQURZ is ready to collect real payments:

1. Replace the Worker secret with the Stripe live secret using `npx wrangler secret put STRIPE_SECRET_KEY` and provide the `sk_live_...` value.
2. Change `PAYMENTS_MODE` from `test` to `live` in the Worker configuration (or equivalent production environment configuration).
3. Deploy the Worker.
4. Keep `PREMIUM_3D_PRICE_CENTS=499` for the $4.99 one-time Premium 3D unlock, or change the amount deliberately.

The frontend checks the returned Checkout Session with the server before loading Three.js, and re-verifies the saved Checkout Session on later visits. The old local prototype unlock flag is no longer accepted.

### Production fulfillment requirement

Before treating paid access as a durable account entitlement across devices, add a persistent user/account entitlement store and a Stripe webhook endpoint for `checkout.session.completed` (and delayed-payment success events where applicable). The redirect landing page is useful for immediate access but should not be the only fulfillment mechanism.

## Live tournament payments are intentionally guarded

`LIVE_TOURNAMENT_PAYMENTS` defaults to `disabled`. Even if Premium 3D is in live mode, real tournament entry charges will return a server error until this flag is explicitly changed to `enabled` after QQURZ has the event operations, prize rules, eligibility, refunds and jurisdiction/compliance requirements ready.

The tournament catalog currently demonstrates 10, 32, 100 and 256-player official event capacities. The existing realtime server handles private head-to-head rooms; large-scale Swiss/knockout tournament orchestration, registration persistence and pairing are a separate backend layer and should not be confused with merely listing a 100-player event.
