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

## iPhone 11 interaction targets

These are on-device goals rather than deterministic CI gates because they depend on network, battery state, thermal state and Safari scheduling.

- Existing-user shell should show useful UI in about 1 second on a healthy connection and remain usable while lazy routes download.
- First Contentful Paint target: <= 1.0 s on a warm/normal mobile connection; investigate > 1.5 s.
- Largest Contentful Paint target: <= 1.8 s; investigate > 2.5 s.
- Cumulative Layout Shift target: <= 0.05; hard ceiling 0.10.
- Interaction input delay target: <= 50 ms; investigate any sustained or repeated > 100 ms interaction delay.
- Long tasks: zero during ordinary board interaction where practical; any task >= 50 ms is recorded and should be investigated if repeated.
- Chessground must become interactive without waiting for Stockfish, Premium 3D, or the Three.js physical-clock renderer.

## Premium 3D targets

- Target 60 FPS while the camera is moving where practical.
- Never trade sustained heat for resolution. On repeated missed frame budgets, render scale steps down to 0.82 and then 0.68; shadows are disabled at the lowest quality tier.
- Lower-power iOS devices use a low-power WebGL preference and skip multisample antialiasing.
- iPhone-class DPR remains capped; hidden tabs stop scheduled rendering and controls until visible again.
- Quality only degrades during a session; it does not oscillate upward and repeatedly heat the device.

## Runtime measurement

The app installs a lightweight, local-only `PerformanceObserver` collector. It does not upload telemetry.

In the browser console:

```js
window.__QQURZ_PERFORMANCE__?.()
```

returns FCP, LCP, CLS, long-task count/total/max, maximum observed event input delay, maximum interaction duration, and JS heap usage when the browser exposes a supported memory API.

Premium 3D additionally exposes:

```js
window.__QQURZ_3D_PERFORMANCE__?.()
```

which returns target FPS, recent measured FPS, current quality scale, shadow state and slow-frame count.

Safari on iPhone does not expose a dependable JS heap API in all versions. In that case memory is reported as `unavailable`; do not substitute a guessed value.

## Prefetch policy

QQURZ does not bulk-prefetch gameplay routes after startup. Prefetch is allowed only from a concrete user-intent signal such as pointer hover, keyboard focus or touch/press on the destination. Data-saver and 2G-class connections suppress intent prefetch. Entering Premium 3D prefetches only its lightweight access gate; Three.js stays behind the verified Premium renderer boundary.
