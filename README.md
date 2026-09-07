# QQURZ Chess — Freestyle 960

**Domain:** `qqurzchess.com`

A responsive Chess960 / Freestyle Chess platform built with React, Vite, Chessground, chessops, Stockfish 18 and an optional Cloudflare Durable Objects realtime server.

## Included

- Official Chess960 position IDs `0–959` (`#518` = classical chess)
- Legal Chess960 FEN/castling and validation through `chessops`
- Responsive Chessground board with aligned pieces
- White pieces stay white and dark pieces are rendered truly black on the brown board
- **CHECK** and large **CHECKMATE** board callouts
- Three play paths: local Human vs Human, Human vs Stockfish AI, and Online Multiplayer
- Stockfish 18 Lite WASM with Easy, Hard and Crazy Hard levels
- 2-minute strategy phase with fast-forward and a prominent **Start Now** pill
- Pattern selection is locked once a live game begins
- Online private room codes, synchronized clocks/state and authoritative move validation
- Free-tournament + future prize-tournament UI roadmap
- GitHub Pages deployment prepared for the `qqurzchess.com` custom domain

## Online multiplayer

The browser UI is in `src/multiplayer/`. The real-time server is in `server/` and uses Cloudflare Workers + Durable Objects + WebSockets. GitHub Pages alone cannot provide an authoritative multi-user game server.

See [`docs/DOMAIN_AND_MULTIPLAYER.md`](docs/DOMAIN_AND_MULTIPLAYER.md) for deployment and GoDaddy DNS instructions.

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
npm run deploy
```

## Money/prize tournaments

Cash-entry collection is intentionally not enabled in this build. The UI can present future prize events, but payments/payouts require jurisdiction-specific legal/regulatory approval and a processor that explicitly supports the approved activity.

## Main architecture

- `src/AppV12.tsx` — QQURZ product home and game-mode routing
- `src/App.tsx` — stable local/AI game runtime
- `src/multiplayer/OnlineArena.tsx` — live-room frontend
- `src/multiplayer/client.ts` — room REST/WebSocket client
- `server/src/index.ts` — authoritative room/game Durable Object
- `src/game/chess960.ts` — Chess960 ID → back rank + FEN
- `src/engine/stockfish.ts` — Stockfish UCI worker
- `scripts/copy-stockfish.mjs` — stages browser WASM assets

## License

GPL-3.0-or-later. Chessground, chessops, Stockfish and Stockfish.js are GPL-family open-source projects; review and comply with their upstream notices/licenses when distributing the platform.
