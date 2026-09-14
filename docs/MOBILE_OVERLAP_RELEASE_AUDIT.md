# Mobile overlap release audit

Every GitHub Pages release is blocked by a dedicated iOS/Safari-oriented overlap audit. The release workflow runs `npm run test:mobile-overlap` before the production build or Pages upload can proceed.

## Release contract

The audit has two non-negotiable layout requirements:

1. `documentElement.scrollWidth` and `body.scrollWidth` must never exceed the visual viewport by more than one rounding pixel.
2. A visible fixed or sticky control must remain inside the viewport, and the center of every visible active control must remain hit-testable instead of being covered by another fixed layer.

The suite runs with the app's **Extra large** text setting enabled, because that is the most demanding supported text scale.

## Required mobile states

The WebKit release suite covers:

- Safari-style dynamic viewport height with the browser bars represented in expanded and collapsed states.
- Portrait safe-area pressure and landscape notch-side safe-area pressure.
- Runtime portrait → landscape → portrait rotation.
- Virtual-keyboard pressure by focusing a real room-code input and shrinking the visual viewport while it remains focused.
- Mobile drawer open.
- Blocking fair-play modal open.
- Local game board.
- Physical 3D chess clock.
- Online pawn-promotion dialog.
- Real U.S. quarter flip overlay.
- Premium checkout success and cancel returns.
- Tournament checkout return.
- Paid room checkout return.
- Server-side opponent reconnecting state and local-network reconnecting state.

The online tests use the production `OnlineArena`, Chessground board, quarter renderer, clock UI and reconnect client with a deterministic mocked room transport. They do not use replacement test components.

## Safari and safe-area fidelity

Headless Playwright WebKit cannot render the literal iOS Safari address-bar chrome or summon the operating-system keyboard. The audit therefore tests the layout effects that matter to QQURZ:

- expanded/collapsed browser bars are represented by changing the WebKit visual viewport height while the page is live;
- the keyboard case focuses the real input and compresses the WebKit viewport to keyboard-like height;
- production CSS is required to contain all four `safe-area-inset-*` guards;
- a synthetic release-only safe-area harness supplies portrait top/bottom and landscape left/right inset pressure so dialogs, navigation and controls are exercised with non-zero inset values.

A final manual check on physical iPhone Safari is still useful for browser-UI behavior that no desktop CI runner can reproduce, but it is not allowed to replace the automated gate.

## Run locally

```bash
npm install
npx playwright install webkit
npm run test:mobile-overlap
```

On failure, CI retains the Playwright HTML report, screenshots, trace, and video under the `mobile-overlap-report` artifact. A failed audit prevents the Pages build/deploy jobs from releasing that commit.
