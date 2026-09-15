# QQURZ Chess — Freestyle 960

**Production domain:** `qqurzchess.com`

QQURZ Chess is a U.S.-based, responsive Chess960 / Freestyle Chess platform built with React, Vite, Chessground, chessops, Stockfish 18 and a Cloudflare Durable Objects realtime server for global cross-network play.

> **Project status: development.** A successful build or polished screen does not make QQURZ “finished.” Core launch readiness and paid-event readiness are defined separately in [`docs/LAUNCH_BAR.md`](docs/LAUNCH_BAR.md). Real-money tournament entry remains disabled until the stricter paid-events bar is satisfied.

## Included

- Official Chess960 position IDs `0–959` (`#518` = classical chess)
- Legal Chess960 FEN/castling and validation through `chessops`
- Responsive Chessground board with pieces centered in their exact squares
- White pieces remain white; Black pieces are rendered truly black on the brown board
- **CHECK** and large diagonal **CHECKMATE** board callouts
- Local Human vs Human, Human vs Stockfish AI, private online rooms, public matchmaking and tournament surfaces
- Stockfish 18 Lite WASM with Easy, Hard and Crazy Hard levels
- 2-minute strategy phase with fast-forward and a prominent **Start Now** action
- **Choose Pattern** instead of Shuffle; pattern/reset navigation is locked once a live game is in progress
- Online private room codes, shareable invite links, reconnectable seats, synchronized clocks/state and authoritative move validation
- Server-side check/checkmate/draw/resignation/time-forfeit results
- Free-tournament product path plus a future U.S. entry-fee/prize-fund tournament roadmap
- GitHub Pages deployment prepared for the `qqurzchess.com` GoDaddy-managed custom domain

## Launch contract

QQURZ follows one top-level release contract: [`docs/LAUNCH_BAR.md`](docs/LAUNCH_BAR.md).

The core product is not launch-ready until a new player can, without outside instruction, open the app, create/sign in to an account, choose a tournament/friend/same-device game, complete a correct Chess960 game with correct clocks, survive disconnect/reconnect without corrupting the match, see history/rating afterward, use the whole player journey at large text size, switch dark/light mode, and complete the flow smoothly on the iPhone 11-class target.

Paid events have a separate bar covering ledger integrity, refunds, webhook recovery/reconciliation, legal/compliance review, anti-cheat operations, support procedures and verified payouts. Checkout functioning by itself is not sufficient.

The default development order is also locked in that document:

**Design System → Home/Navigation → 2D Game Fidelity → Chess960 Rules/Clock → Accounts → Realtime Friend Games → Matchmaking → Ratings/History → Tournament Engine → Reconnect/Spectating → Anti-cheat/Moderation → Stripe/Ledger → Paid Tournaments → Premium 3D → Admin/Analytics → Performance/Accessibility/QA → Launch**

## Architectural invariant

**One chess state model, many presentations.**

Homepage preview, local play, AI, online friend games, tournament matches, spectator boards and Premium 3D must consume the same canonical chess/game state and rules path instead of becoming separate chess implementations.

Current ownership:

- `shared/gameSession.ts` — canonical lifecycle, clocks, connection state and result transitions
- `shared/chess960Rules.ts` — shared Chess960 adjudication/history helpers
- `shared/timeControl.ts` — canonical time-control definitions/policy
- `src/game/useGameSession.ts` — React adapter to the shared game-session reducer
- `src/game/useLocalGameController.ts` — local/AI controller; Stockfish chooses moves but does not own state
- `server/src/index.ts` — authoritative online room controller using the same shared session/rules modules
- `src/ui/ChessBoardSurface.tsx` — shared 2D board presentation
- `src/ui/HomeBoardPreview.tsx` — read-only homepage board presentation
- `src/multiplayer/OnlineArena.tsx` — presentation/controller for authoritative room snapshots
- `src/premium/PremiumBoard3D.tsx` — alternate 3D presentation over the shared local controller

See [`docs/LAUNCH_BAR.md`](docs/LAUNCH_BAR.md) for the prohibited-architecture rules and full acceptance criteria.

## Online multiplayer

The room UI is in `src/multiplayer/`. The realtime server is in `server/` and uses Cloudflare Workers + Durable Objects + the WebSocket Hibernation API. GitHub Pages remains the static frontend host; cross-network rooms require the Worker deployment.

The server, not either player's browser, owns the Chess960 setup, legal moves, turn, clocks and final result.

See [`docs/DOMAIN_AND_MULTIPLAYER.md`](docs/DOMAIN_AND_MULTIPLAYER.md) for the GoDaddy DNS, GitHub Pages and Worker deployment instructions.

## Performance target

The mobile performance budget protects the iPhone 11-class experience first. Bundle limits, 2D runtime budgets and Premium 3D budgets are documented in [`docs/PERFORMANCE_BUDGETS.md`](docs/PERFORMANCE_BUDGETS.md).

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

Real-money registration is intentionally **disabled** in this build. Before it is enabled, the production business needs the paid-events launch bar, including U.S. state-by-state eligibility review, Official Rules, age/identity and fair-play controls, tax/payout operations, support procedures, audited ledger/refund/webhook recovery, and a payment provider that explicitly approves the final model.

See [`docs/US_TOURNAMENT_PRODUCT.md`](docs/US_TOURNAMENT_PRODUCT.md) for the product/compliance blueprint and [`docs/LAUNCH_BAR.md`](docs/LAUNCH_BAR.md) for the release gate.

## License

GPL-3.0-or-later. Chessground, chessops, Stockfish and Stockfish.js are GPL-family open-source projects; review and comply with their upstream notices/licenses when distributing the platform.
