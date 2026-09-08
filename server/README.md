# QQURZ Chess realtime + tournament test server

Authoritative Chess960 room server for players on different networks. It runs on Cloudflare Workers + Durable Objects and uses the WebSocket Hibernation API.

## What the server owns

- private six-character room codes and seat tokens
- white/black seats and presence
- Chess960 pattern generation
- server-side legal move validation with `chessops`
- shared two-minute strategy phase
- authoritative 10-minute clocks and time forfeits
- check/checkmate/draw results
- pattern locking once play starts
- synchronized WebSocket snapshots
- tournament catalog for prototype $1 / $5 / $10 / $20 entry flows
- Stripe **test-mode** Checkout Session creation and server-side session verification

The browser is never trusted to decide whether a chess move is legal or who won.

## 1. Deploy multiplayer

```bash
cd server
npm install
npm run check
npx wrangler login
npm run deploy
```

After deployment, Wrangler prints a `https://...workers.dev` URL. Add that URL to the GitHub repository Actions variable:

```text
VITE_MULTIPLAYER_API=https://YOUR-WORKER.workers.dev
```

Then rerun the Pages deployment. Two devices on different networks can create/join the same private room once that variable is present in the frontend build.

For production, map `api.qqurzchess.com` to the Worker and use:

```text
VITE_MULTIPLAYER_API=https://api.qqurzchess.com
```

The default allowed browser origins are `https://qqurzchess.com`, `https://www.qqurzchess.com`, the GitHub Pages fallback, and local Vite development.

## 2. Turn on payment testing

The committed config uses `PAYMENTS_MODE=test`. The server refuses to create a Checkout Session unless the secret starts with `sk_test_`.

Add your Stripe **test** secret to Cloudflare:

```bash
cd server
npx wrangler secret put STRIPE_SECRET_KEY
```

Paste the `sk_test_...` key when prompted, then deploy again:

```bash
npm run deploy
```

The frontend tournament lab will then enable the $1, $5, $10 and $20 test-entry buttons. The premium 3D pass also uses the same test checkout path; its prototype price is configured by `PREMIUM_3D_PRICE_CENTS` in `wrangler.jsonc`.

Checkout success is verified by the server by retrieving the Stripe Checkout Session. For a public production launch, add a durable entitlement/entry store and Stripe webhook fulfillment before treating payment as a permanent tournament seat. The browser redirect alone must never be the source of truth.

## 3. Test with two devices

1. Device A opens `https://qqurzchess.com` → **Online** → **Create private room**.
2. Copy the invite link or six-character code.
3. Device B can be on a different Wi-Fi/cellular network; open the link or enter the code.
4. Player two joins as Black.
5. Both browsers receive the same authoritative position, strategy countdown, clocks, moves and result.

For tournament payment testing, use Stripe's documented test card `4242 4242 4242 4242`, any future expiry and any 3-digit CVC.
