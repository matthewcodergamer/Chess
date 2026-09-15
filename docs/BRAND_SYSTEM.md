# QQURZ visual identity

QQURZ should feel like one native-quality chess product across iPhone, tablet and desktop. Reference products can inform hierarchy and usability, but QQURZ keeps its own brand, assets and interaction language.

## Typography

QQURZ uses a platform-native sans-serif stack rather than downloading a webfont on startup:

```css
-apple-system,
BlinkMacSystemFont,
"SF Pro Text",
"SF Pro Display",
"Segoe UI",
Roboto,
"Helvetica Neue",
Arial,
sans-serif
```

That choice is intentional. On iPhone it resolves to Apple's San Francisco family; Android resolves naturally to Roboto; Windows uses Segoe UI. It gives QQURZ the clean, familiar geometry of modern native apps without a font-loading flash, privacy dependency or extra startup bytes.

Headings and the QQURZ wordmark use the same family with heavier weight and tighter tracking. Chess identity comes from the board, pieces, QQURZ mark, terminology and green action system—not from decorative newspaper-style serif typography.

## QQURZ green palette

The brand is green, but the whole interface is not painted green. Bright green is reserved for action, selection, presence and positive game state. Warm charcoal surfaces keep the board and game state visually dominant.

### Dark

- Canvas: `#262522`
- Primary surface: `#302e2a`
- Raised surface: `#3a3834`
- Strong raised surface: `#47443f`
- Primary text: `#f5f5f2`
- Muted text: `#c2c0ba`
- Action green: `#79b64c`
- Action hover: `#88c659`
- Strong accent: `#a7d96f`

### Light

- Canvas: `#f3f0e8`
- Primary surface: `#fcfaf5`
- Raised surface: `#eae5da`
- Strong raised surface: `#dcd5c8`
- Primary text: `#1f1e1a`
- Muted text: `#69665f`
- Action green: `#5f933b`
- Strong accent: `#3f6f27`

The result should feel like a warm chess room with a confident green identity, not a green-tinted dashboard. All product CSS consumes variables in `src/styles/tokens.css`; feature screens must not hard-code their own palette.

## App icon and mark

Canonical assets:

- `public/brand/qqurz-app-icon.svg` — rounded QQURZ web-app icon.
- `public/brand/qqurz-app-icon-maskable.svg` — full-bleed maskable PWA icon.
- `public/brand/qqurz-mark.svg` — transparent pawn mark for the in-app wordmark and monochrome browser use.
- `public/favicon.svg` — browser favicon using the same app-icon artwork.

The refreshed mark uses a QQURZ-specific green pawn with simple three-dimensional shading and a restrained board motif on warm charcoal. It is intentionally recognizable at favicon size and is not a reproduction of another chess service's logo.

## Mobile account/onboarding language

First-run and signed-out account screens use a calm full-screen hierarchy: brand mark, one clear title, readable supporting copy, one primary green action, restrained secondary actions and large touch targets. Avoid floating SaaS-card styling, unnecessary gradients, tiny labels and decorative controls.

## Usage rules

1. Reserve bright green for primary action, selection, presence and positive state.
2. Keep the chess board visually dominant on game screens.
3. Use the shared button, radius, elevation and icon systems.
4. Prefer native platform typography over remotely loaded fonts.
5. Maintain AA-level text contrast and all existing large-text/high-contrast modes.
6. Do not create screen-specific brand colors or alternate QQURZ marks.
7. Use restrained physical depth—small highlights and shadows, never neon glow.
