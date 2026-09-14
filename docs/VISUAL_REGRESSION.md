# Visual regression testing

QQURZ keeps a canonical screenshot matrix so responsive CSS and component changes cannot silently reintroduce overlaps, clipped controls, broken chess pieces, or layout drift.

## Canonical viewport matrix

The suite runs nine product surfaces at five widths: iPhone SE (375 x 667), iPhone 11 (414 x 896), tablet (768 x 1024), laptop (1366 x 768), and desktop (1600 x 1000).

The protected surfaces are the app header, homepage, menu drawer, tournament registration, game board, physical clock, blocking modal, account page, and settings screen. This produces 45 committed baseline images.

## Commands

`npm run test:visual` compares the current app against the committed baselines.

`npm run test:visual:update` intentionally regenerates the screenshots. Review the changed PNGs and only commit them when the UI change is deliberate.

Normal Playwright E2E tests ignore `visual-regression.spec.ts`; the dedicated visual Playwright configuration owns the five-device screenshot matrix.

## CI behavior

The main quality workflow requires exactly 45 committed baseline PNGs and runs the visual comparison after functional E2E tests. A missing baseline, unexpected extra baseline, visual mismatch, or horizontal overflow fails the quality gate. Visual failures upload the Playwright report plus actual and diff images as a workflow artifact.

Baseline regeneration does not run automatically on a normal push or pull request. The `Update visual regression baselines` workflow is manual-only and should be run after an intentional UI change has been reviewed. It regenerates the full 45-image matrix and commits changes only when screenshots differ.

## Stability rules

The suite fixes onboarding, account, presence, tournament data, Chess960 randomness, theme, text scale, API data, reduced-motion preference, and browser sizes. Animations and transitions are disabled for capture, and every canonical screen checks for horizontal overflow before its screenshot is accepted.
