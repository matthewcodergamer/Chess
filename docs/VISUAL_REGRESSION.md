# Visual regression testing

QQURZ keeps a canonical screenshot matrix so responsive CSS and component changes cannot silently reintroduce overlaps, clipped controls, broken chess pieces, or layout drift.

## Canonical viewport matrix

The visual suite runs the same nine product surfaces at five widths:

- iPhone SE — 375 × 667
- iPhone 11 — 414 × 896
- Tablet — 768 × 1024
- Laptop — 1366 × 768
- Desktop — 1600 × 1000

The protected surfaces are the app header, homepage, menu drawer, tournament registration, game board, physical clock, blocking modal, account page, and settings screen. That produces 45 committed baseline images.

## Commands

`npm run test:visual` compares the current app against the committed baselines.

`npm run test:visual:update` intentionally regenerates the screenshots. Baseline updates should be reviewed like code: inspect the changed PNGs and only commit them when the UI change is deliberate.

Normal Playwright E2E tests intentionally ignore `visual-regression.spec.ts`; the dedicated visual Playwright configuration owns the five-device screenshot matrix.

## CI behavior

The main quality workflow installs Chromium and runs the visual suite after functional E2E tests. A visual mismatch fails the quality gate and uploads the Playwright visual report plus actual/diff images as a workflow artifact.

The one-time bootstrap workflow exists only to create the first missing baseline matrix. Once baselines exist it does not rewrite them on normal UI changes, so future CSS changes are compared against the committed reference images rather than silently accepted.

## Stability rules

The suite fixes onboarding, account, presence, tournament, Chess960 randomness, theme, text scale, API data, reduced-motion preference, and browser sizes. Animations/transitions are disabled for capture, and every canonical screen also checks for horizontal overflow before its screenshot is accepted.
