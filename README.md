# QURR Chess — Freestyle 960

A responsive Chess960 / Freestyle Chess web app built for GitHub Pages.

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
- Automatic GitHub Pages deployment workflow

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

This repository includes `.github/workflows/deploy-pages.yml` and Vite is configured with `base: '/Chess/'` for the repository URL.

In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions** once. After that, pushes to `main` deploy automatically.

## Core libraries

- React + TypeScript + Vite
- `@lichess-org/chessground`
- `chessops`

## License note

Chessground and chessops are GPL-3.0-or-later projects. If you distribute a derivative that incorporates them, review and comply with their license terms.
