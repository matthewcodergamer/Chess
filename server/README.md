# QQURZ Chess realtime server

Authoritative Chess960 room server for players on different networks. It runs on Cloudflare Workers + Durable Objects and uses WebSocket Hibernation.

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

The browser is never trusted to decide whether a move is legal or who won.

## Deploy

```bash
cd server
npm install
npm run check
npx wrangler login
npm run deploy
```

After deployment, Wrangler prints a `https://...workers.dev` URL. Add that URL to the GitHub repository Actions variable `VITE_MULTIPLAYER_API`, then rerun the Pages deployment.

For production, map `api.qqurzchess.com` to this Worker and set:

```text
VITE_MULTIPLAYER_API=https://api.qqurzchess.com
```

The default allowed browser origins are `https://qqurzchess.com`, `https://www.qqurzchess.com`, the GitHub Pages fallback, and local Vite development. Change `ALLOWED_ORIGINS` in `wrangler.jsonc` if needed.

## Money / tournament note

This server intentionally does not collect entry fees, hold player funds, or pay cash prizes. QQURZ can use the same authoritative game records for tournament brackets later, but U.S. paid-entry prize competitions should be enabled only after state-by-state rules, official contest rules, age/identity controls, tax handling, and a payment provider that explicitly approves the business model are in place.
