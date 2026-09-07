# QURR Chess — Freestyle 960

A responsive Chess960 / Freestyle Chess web app built for GitHub Pages.

## Live site

**https://matthewcodergamer.github.io/Chess/**

## What works

- All 960 legal Scharnagl starting positions (`#0` to `#959`)
- Position `#518` maps to the traditional chess starting position
- 2-minute pre-game strategy phase with automatic clock start
- 10-minute local two-player clocks
- Legal move validation with `chessops`
- Touch-friendly board rendering with Lichess Chessground
- Chess960 rook-side castling support
- Promotion chooser
- Checkmate, stalemate, insufficient-material and flag detection
- Move history, board flip, FEN copy, reset and reshuffle controls
- Responsive iPhone/mobile layout
- Automatic GitHub Pages build and deployment from `main`

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

## License note

Chessground and chessops are GPL-3.0-or-later projects. If you distribute a derivative that incorporates them, review and comply with their license terms.
