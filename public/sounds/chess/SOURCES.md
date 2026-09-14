# QQURZ recorded chess sounds

QQURZ deliberately uses short recorded / organic sounds instead of synthesized Web Audio tones. Production builds fetch the assets in `scripts/fetch-chess-audio.mjs` into this directory before Vite packages the site, so a live match does not depend on OpenGameArt being reachable.

## CC0 sources

- `move.mp3`, `check.mp3`, `game-start.mp3`, `clock.mp3`: **Click sounds(6)** by pauliuw — CC0 1.0. Source: https://opengameart.org/content/click-sounds6
- `capture.wav`, `game-end.wav`: **Mechanical Sounds** by Brian MacIntosh (BMacZero) — CC0 1.0. Source: https://opengameart.org/content/mechanical-sounds
- `coin.mp3`: **Coin Drop** by Vinrax — CC0 1.0. Source: https://opengameart.org/content/coin-drop

Castling is represented as two restrained recorded board-contact sounds in sequence, reflecting the king and rook being placed rather than playing a synthetic success cue.

The source pages mark these works CC0; attribution is therefore not required, but QQURZ keeps this provenance file for auditability.
