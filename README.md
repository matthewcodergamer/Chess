# QQURZ Chess — Freestyle 960

**Production domain:** `qqurzchess.com`

QQURZ Chess is a U.S.-based, responsive Chess960 / Freestyle Chess platform built with React, Vite, Chessground, chessops, Stockfish 18 and a Cloudflare Durable Objects realtime server for global cross-network play.

## Included

- Official Chess960 position IDs `0–959` (`#518` = classical chess)
- Legal Chess960 FEN/castling and validation through `chessops`
- Responsive Chessground board with pieces centered in their exact squares
- White pieces remain white; Black pieces are rendered truly black on the brown board
- **CHECK** and large diagonal **CHECKMATE** board callouts
- Three play paths: local Human vs Human, Human vs Stockfish AI, and Online Multiplayer
- Stockfish 18 Lite WASM with Easy, Hard and Crazy Hard levels
- 2-minute strategy phase with fast-forward and a prominent black-on-yellow **Start Now** pill
- **Choose Pattern** instead of Shuffle; pattern/reset navigation is locked once a live game is in progress
- Official uploaded QQURZ wordmark throughout the product
- Online private room codes, shareable invite links, reconnectable seats, synchronized clocks/state and authoritative move validation
- Server-side check/checkmate/draw/resignation/time-forfeit results
- Free-tournament product path plus a future U.S. entry-fee/prize-fund tournament roadmap
- GitHub Pages deployment prepared for the `qqurzchess.com` GoDaddy-managed custom domain

## Online multiplayer

The room UI is in `src/multiplayer/`. The realtime server is in `server/` and uses Cloudflare Workers + Durable Objects + the WebSocket Hibernation API. GitHub Pages remains the static frontend host; cross-network rooms require the Worker deployment.

The server, not either player's browser, owns the Chess960 setup, legal moves, turn, clocks and final result.

See [`docs/DOMAIN_AND_MULTIPLAYER.md`](docs/DOMAIN_AND_MULTIPLAYER.md) for the GoDaddy DNS, GitHub Pages and Worker deployment instructions.

## Run frontend locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

To point the frontend at a deployed realtime server, copy `.env.example` to `.env.local` and set:

```text
VITE_MULTIPLAYER_API=https://YOUR-WORKER.workers.dev
```

## Deploy realtime server

```bash
cd server
npm install
npm run check
npx wrangler login
npm run deploy
```

## U.S. tournament model

QQURZ's intended paid-event model is an **entry-fee chess skill tournament with a published prize fund** — not betting, odds, wagering, side bets or player-vs-player staking.

Real-money registration is intentionally **disabled** in this build. Before it is enabled, the production business needs U.S. state-by-state eligibility review, Official Rules, age/identity and fair-play controls, tax/payout operations, and a payment provider that explicitly approves the final model.

See [`docs/US_TOURNAMENT_PRODUCT.md`](docs/US_TOURNAMENT_PRODUCT.md) for the product/compliance blueprint.

## Main architecture

- `src/AppV12.tsx` — QQURZ home, branding and game-mode routing
- `src/App.tsx` — stable local/AI game runtime
- `src/multiplayer/OnlineArena.tsx` — cross-network room frontend
- `src/multiplayer/client.ts` — room REST/WebSocket client
- `server/src/index.ts` — authoritative room/game Durable Object
- `server/src/chess960.ts` — server-side Chess960 generation
- `src/game/chess960.ts` — browser Chess960 ID → back rank + FEN
- `src/engine/stockfish.ts` — Stockfish UCI worker
- `scripts/copy-stockfish.mjs` — stages browser WASM assets

## License

GPL-3.0-or-later. Chessground, chessops, Stockfish and Stockfish.js are GPL-family open-source projects; review and comply with their upstream notices/licenses when distributing the platform.
