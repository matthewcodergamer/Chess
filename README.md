# QURR Chess — Freestyle 960

A responsive Chess960 / Freestyle Chess web app built for GitHub Pages with React, Vite, Chessground and chessops.

## Included now

- Official Chess960 position IDs `0–959` using Scharnagl numbering (`#518` = classical chess)
- Valid Chess960 starting FEN with rook-file castling rights
- Chessground board with touch + drag support
- Legal move validation through chessops
- Chess960 castling by dragging the king onto the destination rook
- Promotion picker
- 2-minute pre-game strategy phase
- Live game clocks with 3+2, 5+0, 10+0 and 15+10 presets
- Move history in SAN, check/checkmate/stalemate/insufficient-material handling
- Board flip, reset, FEN copy and direct position-ID loading
- Mobile-first responsive layout
- GitHub Actions workflow for GitHub Pages

## Run locally

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
npm run preview
```

## Publish on GitHub Pages

The repository already contains `.github/workflows/deploy-pages.yml`.

1. Open **Settings → Pages** in this GitHub repository.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main` (or manually run the **Deploy QURR Chess to GitHub Pages** workflow).
4. GitHub will publish the generated `dist/` site.

Vite uses relative asset paths, so this works correctly from the `/Chess/` project-page path and can also move to a custom domain later.

## Architecture

The UI is deliberately separated from game rules:

- `src/chess960.ts` — position ID → back-rank/FEN generation
- `chessops` — rule validation, legal moves, Chess960 castling and SAN
- `@lichess-org/chessground` — fast browser/touch board renderer
- `src/App.tsx` — strategy timer, clocks, move history and match state

## License

GPL-3.0-or-later. Chessground and chessops are also GPL-3.0-or-later.
