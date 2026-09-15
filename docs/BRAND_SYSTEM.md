# QQURZ visual identity

QQURZ should feel like one native-quality chess product across iPhone, tablet and desktop. Reference products can inform hierarchy and usability, but QQURZ keeps its own brand, assets and interaction language.

## Typography

QQURZ uses the platform-native UI stack rather than downloading a webfont on startup:

```css
-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, Roboto, "Helvetica Neue", Arial, sans-serif
```

On iPhone this resolves to Apple's San Francisco family; Android can resolve to Roboto; other platforms receive a high-quality native sans-serif. This keeps text crisp, avoids a font-loading flash and protects the startup performance budget.

Headings and the QQURZ wordmark use the same family with heavier weight and tighter tracking. Chess identity comes from the board, pieces and QQURZ mark rather than from an unrelated decorative serif.

## Forest-green palette

Green is the QQURZ action color, not the background of every surface. The interface uses quiet forest-charcoal neutrals so the board remains the visual focus and green means something.

### Dark

- Canvas: `#151814`
- Primary surface: `#1d211c`
- Raised surface: `#272c25`
- Strong raised surface: `#323930`
- Primary text: `#f4f6f1`
- Muted text: `#b9c1b5`
- Action green: `#7fba4a`
- Action hover: `#8dca56`
- Strong accent: `#a8d97c`

### Light

- Canvas: `#f2f5ee`
- Primary surface: `#fbfcf8`
- Raised surface: `#e8eee3`
- Strong raised surface: `#dae4d4`
- Primary text: `#192116`
- Muted text: `#65705f`
- Action green: `#5d9837`
- Strong accent: `#416d29`

All product CSS consumes the variables in `src/styles/tokens.css`; feature screens must not hard-code these values.

## App icon

Canonical assets:

- `public/brand/qqurz-app-icon.svg` — rounded QQURZ icon for favicon/interface use.
- `public/brand/qqurz-app-icon-maskable.svg` — full-bleed maskable web-app icon.
- `public/favicon.svg` — browser favicon using the same artwork.

The mark is a QQURZ-specific green pawn over a restrained board motif on a forest background. It is intentionally not a reproduction of another chess service's piece or logo.

## Mobile account/onboarding language

First-run and signed-out account screens use a calm full-screen hierarchy: brand mark, one clear title, readable supporting copy, one primary green action, restrained secondary actions and large touch targets. Avoid floating SaaS-card styling, unnecessary gradients, tiny labels and decorative controls.

## Usage rules

1. Reserve bright green for primary action, selection, presence and positive state.
2. Keep the chess board visually dominant on game screens.
3. Use the shared button, radius, elevation and icon systems.
4. Prefer native platform typography over remotely loaded fonts.
5. Maintain AA-level text contrast and all existing large-text/high-contrast modes.
6. Do not create screen-specific brand colors or alternate QQURZ marks.
