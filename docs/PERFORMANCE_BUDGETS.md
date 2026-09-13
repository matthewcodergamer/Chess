# QQURZ performance budgets

These budgets protect the iPhone 11-class experience first. They are architecture rules, not one-off benchmarks.

## CI-enforced production bundle budgets

`npm run build` emits a Vite manifest and runs `scripts/check-performance-budgets.mjs`.

| Surface | Hard gzip budget |
| --- | ---: |
| Initial JavaScript static closure | 96 KiB |
| Initial CSS | 34 KiB |
| Initial JS + CSS | 135 KiB |
| Account route incremental closure | 16 KiB |
| Tournament route incremental closure | 28 KiB |
| Local 2D route incremental closure | 36 KiB |
| Online arena incremental closure | 52 KiB |
| Premium 3D gate incremental closure | 12 KiB |
| Premium 3D renderer incremental closure | 190 KiB |

The check also fails if account, tournament or Premium 3D gate code becomes part of the initial static closure, or if Stockfish, the Premium 3D board, or the Three.js physical clock becomes a static dependency of normal LocalGame 2D.

## Standard 2D runtime budget

Runtime targets are on-device product goals rather than deterministic CI gates because network, battery state, thermal state and Safari scheduling vary. The budget reporter flags attention items without pretending those environmental differences are build failures.

| Metric | iPhone 11-class standard 2D target |
| --- | ---: |
| First Contentful Paint | <= 1200 ms |
| Largest Contentful Paint | <= 2200 ms |
| Cumulative Layout Shift | <= 0.05 |
| Longest observed task | <= 100 ms |
| Maximum observed input delay | <= 100 ms |
| Maximum observed interaction duration | <= 200 ms |
| JS heap, where measurable | <= 96 MiB |

The UI should normally feel faster than these ceilings. In particular, board taps and navigation should aim for roughly one frame of scheduling delay where practical. Chessground must become interactive without waiting for Stockfish, Premium 3D, the Three.js physical-clock renderer, account, or tournament code.

## Premium 3D runtime budget

Premium 3D intentionally has a separate profile because Three.js, WebGL resources and richer geometry have a higher cost. Its soft runtime ceilings are FCP <= 1600 ms, LCP <= 2800 ms, CLS <= 0.08, longest task <= 150 ms, max input delay <= 150 ms, max interaction duration <= 250 ms and JS heap <= 192 MiB where measurable.

The renderer targets 60 FPS during active interaction, with 55 FPS as the practical lower edge of the target band. If repeated frames miss the budget, quality degrades instead of sustaining heat: render scale drops to 0.82 and then 0.68, and shadows switch off at the lowest tier. Lower-power iPhones use capped DPR, reduced geometry/shadows and a low-power WebGL preference. Rendering pauses when the page is hidden or the board is off-screen.

## Runtime measurement

The app installs a lightweight local-only collector. Nothing is uploaded.

Raw measurements:

```js
window.__QQURZ_PERFORMANCE__?.()
```

Runtime budget evaluation:

```js
window.__QQURZ_PERFORMANCE_BUDGETS__?.()
```

The budget report identifies the active `standard-2d` or `premium-3d` profile, returns the applicable targets, marks whether observed metrics are within budget, lists attention items, and explicitly lists unavailable metrics.

The collector uses native PerformanceObserver entries for paint, layout shift, Long Tasks and Event Timing where supported. Safari fallbacks are labeled rather than presented as native measurements. JS heap is sampled periodically only when a supported browser API exists; on iPhone Safari it can legitimately remain `unavailable`.

Premium 3D additionally exposes:

```js
window.__QQURZ_3D_PERFORMANCE__?.()
```

which returns the 60 FPS target, 55 FPS practical threshold, recent measured FPS, active pixel ratio, quality scale, shadow state, slow-frame count and whether the renderer is still on the target tier or has degraded quality.

## Prefetch policy

QQURZ does not bulk-prefetch gameplay routes after startup. Prefetch is allowed only from a concrete user-intent signal such as pointer hover, keyboard focus or touch/press on the destination. Data-saver and 2G-class connections suppress intent prefetch. Entering Premium 3D prefetches only its lightweight access gate; Three.js stays behind the verified Premium renderer boundary.
