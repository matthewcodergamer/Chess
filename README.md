# QURR Chess — Freestyle 960

A responsive Chess960 / Freestyle Chess web app built for GitHub Pages with React, Vite, Chessground, chessops and Stockfish 18.

## Live site

**https://matthewcodergamer.github.io/Chess/**

## What works

- All 960 legal Scharnagl starting positions (`#0` to `#959`)
- Position `#518` maps to the traditional chess starting position
- Chess pieces stay centered on their exact squares across responsive board sizes
- Two match modes: **Human vs Human** and **Human vs AI**
- Stockfish 18 Lite single-threaded WASM AI running locally in the browser
- AI strengths: **Easy**, **Hard**, and **Crazy Hard**
- Human can choose White, Black, or Random against the robot
- 2-minute pre-game strategy phase with automatic clock start
- Press-and-hold `×4` strategy fast-forward, 10-second tap skip, and Start Now
- 10-minute game clocks
- Legal move validation with `chessops`
- Touch-friendly board rendering with Lichess Chessground
- Chess960 rook-side castling support
- Promotion chooser
- Checkmate, stalemate, insufficient-material and flag detection
- Move history, board flip, FEN copy, reset and reshuffle controls
- Responsive iPhone/mobile layout
- Automatic GitHub Pages build and deployment from `main`

## AI architecture

The browser AI uses the `stockfish` npm package. During builds, `scripts/copy-stockfish.mjs` copies the lightweight Stockfish 18 single-threaded worker and WASM files into `public/stockfish/`, so GitHub Pages serves the engine from the same origin without needing a backend.

`UCI_Chess960` is enabled before engine searches. Difficulty modes tune Stockfish's UCI skill level and thinking time.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. The workflow builds the Vite app, enables GitHub Pages when needed, uploads `dist/`, and deploys it automatically on pushes to `main`.

Vite is configured with `base: '/Chess/'` so assets resolve correctly from the project Pages URL.

## Core libraries

- React + TypeScript + Vite
- `@lichess-org/chessground`
- `chessops`
- `stockfish` / Stockfish.js 18

## License note

The project is GPL-3.0-or-later. Chessground, chessops, Stockfish and Stockfish.js are GPL-family open-source projects; review and comply with their respective upstream license terms when redistributing.
