# Premium 3D renderer boundary

Premium 3D is a presentation layer, not a second chess implementation.

## Source of truth

`useLocalGameController` owns local game rules, move execution, Chess960 legality, promotion, clocks, results, AI turns and the local session state. The normal 2D board and Premium 3D both call `localBoardViewState(game)` and consume the same `ChessBoardViewState` projection.

`ChessBoardViewState` contains only renderer-facing state: FEN, orientation, side to move, check status, last move, movable color and controller-supplied legal destinations. `ThreeBoardRenderer` receives that one object and may only emit a square-to-square move intent through `onMove`. It must never parse/execute chess moves, adjudicate results, run Stockfish, open network transports, pair tournaments or own clocks.

Networking and tournament rules remain in their existing authoritative server/realtime layers. If Premium 3D is later offered for an online or tournament game, the renderer must be fed the same server-derived board state used by the 2D surface; no Premium-specific room, clock, tournament or settlement implementation should be added.

## Rendering budget

The Three.js scene is demand-driven. There is no perpetual animation loop. Rendering pauses when the document is hidden and when the board leaves the viewport.

The board uses one instanced mesh for all 64 square top surfaces. Pieces use one instanced mesh per role across both colors, with per-instance color, for at most six piece draw calls instead of twelve role/color calls. Frame rails and legal destination markers are also instanced. Shared materials are reused rather than cloned per piece.

Geometry detail is device-tiered. Lower-power iPhones use fewer radial segments, a 1.25 device-pixel-ratio cap, a low-power WebGL preference, no MSAA and no shadow maps at startup. Faster devices retain higher quality and may degrade render scale if active frame bursts repeatedly miss the frame budget.

Where the camera cannot see a surface, avoid rendering it. Board squares and the inset are planes, and the table is a top-facing disc rather than a closed cylinder.

## CI guard

`scripts/check-3d-presentation-boundary.mjs` fails the build if chess rules, Stockfish calls, networking or tournament implementation enters the renderer. It also asserts that 2D and 3D both use the shared board-state projection and that the key instancing/visibility/pixel-ratio safeguards remain present.
