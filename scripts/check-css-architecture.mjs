import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'src', 'main.tsx');
const stylesDir = path.join(root, 'src', 'styles');
const indexPath = path.join(stylesDir, 'index.css');
const tokensPath = path.join(stylesDir, 'tokens.css');

const requiredModules = [
  'tokens.css', 'typography.css', 'buttons.css', 'navigation.css', 'home.css',
  'board.css', 'game.css', 'tournaments.css', 'dialogs.css', 'forms.css',
  'payments.css', 'profile.css', 'animations.css', 'responsive.css',
];

const requiredTokens = [
  '--q-space-4:4px', '--q-space-8:8px', '--q-space-12:12px', '--q-space-16:16px',
  '--q-space-24:24px', '--q-space-32:32px', '--q-space-48:48px', '--q-space-64:64px',
  '--q-control-sm:48px', '--q-control-md:56px', '--q-control-lg:64px',
  '--q-type-caption:.875rem', '--q-type-label-sm:.9375rem', '--q-type-label:1rem',
  '--q-type-body:1.0625rem', '--q-type-body-lg:1.125rem', '--q-type-action:1.25rem', '--q-type-action-lg:1.5rem',
  '--q-type-display-match:', '--q-type-display-page-mobile:', '--q-type-display-hero-mobile:', '--q-type-display-ornament:',
  '--q-radius-xs:8px', '--q-radius-sm:12px', '--q-radius-md:16px', '--q-radius-lg:24px', '--q-radius-xl:32px',
  '--q-action:', '--q-action-hover:', '--q-action-active:', '--q-action-soft:',
  '--q-success:', '--q-success-soft:', '--q-danger:', '--q-danger-soft:', '--q-warning:',
  '--q-board-light:', '--q-board-dark:', '--q-board-frame:', '--q-board-legal:',
  '--q-overlay-modal:', '--q-overlay-board:', '--q-overlay-card:',
  '--q-elevation-1:', '--q-elevation-2:', '--q-elevation-3:', '--q-elevation-board:',
  '--q-motion-press:', '--q-motion-fast:', '--q-motion-base:', '--q-motion-slow:', '--q-motion-progress:', '--q-motion-spin:',
];

const errors = [];
const main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("import './styles/index.css';")) errors.push('src/main.tsx must import ./styles/index.css as the only first-party CSS entrypoint.');
if (/import\s+['"]\.\/(?:v\d|styles\.css|experience\.css|product-system\.css)/.test(main)) errors.push('src/main.tsx contains a legacy/versioned stylesheet import.');

const index = fs.readFileSync(indexPath, 'utf8');
for (const file of requiredModules) if (!index.includes(`@import './${file}';`)) errors.push(`styles/index.css is missing ${file}.`);

const tokens = fs.readFileSync(tokensPath, 'utf8');
for (const token of requiredTokens) if (!tokens.includes(token)) errors.push(`tokens.css is missing required token ${token}.`);
if (!/body[^}]*font-size:var\(--q-type-body\)/.test(fs.readFileSync(path.join(stylesDir, 'typography.css'), 'utf8'))) {
  errors.push('Body typography must use --q-type-body (17px at the default scale).');
}

const styleFiles = fs.readdirSync(stylesDir).filter(file => file.endsWith('.css'));
for (const file of styleFiles) {
  const css = fs.readFileSync(path.join(stylesDir, file), 'utf8');
  if (file !== 'responsive.css' && /@media\b/.test(css)) errors.push(`${file} contains @media; viewport rules belong in responsive.css.`);
  if (file === 'tokens.css' || file === 'index.css') continue;

  if (/#[0-9a-fA-F]{3,8}\b/.test(css) || /\b(?:rgb|rgba|hsl|hsla)\s*\(/.test(css)) {
    errors.push(`${file} contains a literal color. Define colors in tokens.css and consume a token.`);
  }

  const spacingPattern = /(?:margin(?:-(?:top|right|bottom|left|inline|block)(?:-start|-end)?)?|padding(?:-(?:top|right|bottom|left|inline|block)(?:-start|-end)?)?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g;
  for (const match of css.matchAll(spacingPattern)) {
    const rawPx = [...match[1].matchAll(/(-?\d+(?:\.\d+)?)px\b/g)].filter(value => Number(value[1]) !== 0);
    if (rawPx.length) {
      errors.push(`${file} contains off-token spacing: ${match[0].trim()}`);
      break;
    }
  }

  for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    if (/\d+(?:\.\d+)?(?:px|rem)\b/.test(value) && !value.includes('var(--q-radius')) {
      errors.push(`${file} contains an ad-hoc radius: ${match[0].trim()}`);
      break;
    }
  }

  for (const match of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    if (/^0(?:\s*!important)?$/.test(value) || value.startsWith('var(') || (value.startsWith('clamp(') && value.includes('var(--q-type'))) continue;
    errors.push(`${file} contains a non-token typography size: ${match[0].trim()}`);
    break;
  }

  const motionCss = css.replaceAll('.01ms', '');
  for (const match of motionCss.matchAll(/(?:transition(?:-[a-z-]+)?|animation(?:-[a-z-]+)?)\s*:\s*([^;}]+)/g)) {
    if (/\b\d+(?:\.\d+)?(?:ms|s)\b/.test(match[1]) && !match[1].includes('var(--q-motion')) {
      errors.push(`${file} contains a hard-coded motion duration: ${match[0].trim()}`);
      break;
    }
  }

  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1];
    const body = match[2];
    if (!selector.includes('button')) continue;
    const height = /min-height\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
    if (height && /\d+(?:\.\d+)?px\b/.test(height) && !height.includes('var(--q-control')) {
      errors.push(`${file} gives a button an off-system height (${height}). Use --q-control-sm/md/lg.`);
      break;
    }
  }

  for (const match of css.matchAll(/(--q-[\w-]+)\s*:/g)) {
    const name = match[1];
    const responsiveOverride = file === 'responsive.css' && (name === '--q-header-h' || name === '--q-page-gutter');
    if (!responsiveOverride) {
      errors.push(`${file} defines ${name}. Design tokens may only be defined in tokens.css.`);
      break;
    }
  }
}

const legacyFiles = fs.readdirSync(path.join(root, 'src')).filter(file => /^v\d+\.\d+\.css$/.test(file));
if (legacyFiles.length) errors.push(`Versioned CSS files must not return: ${legacyFiles.join(', ')}`);

if (errors.length) {
  console.error('\nQQURZ design-system check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('\nUse src/styles/tokens.css instead of introducing screen-specific values.\n');
  process.exit(1);
}

console.log(`QQURZ design system OK: ${requiredModules.length} modules, strict tokens, centralized responsive rules.`);
