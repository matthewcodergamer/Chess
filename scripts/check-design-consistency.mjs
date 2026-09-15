import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const stylesRoot = path.join(srcRoot, 'styles');
const errors = [];
const notes = [];

function walk(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

for (const obsolete of ['src/App.tsx', 'src/AppV12.tsx', 'src/AppV14.tsx']) {
  if (fs.existsSync(path.join(root, obsolete))) errors.push(`${obsolete} is a superseded duplicate application shell.`);
}

const sourceFiles = walk(srcRoot, new Set(['.ts', '.tsx', '.css']));
const versionedClass = /\b(?:qqurz|chess|home|local|online|profile|tournament)[\w-]*-v\d+(?:-\d+)?\b/g;
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = [...new Set(source.match(versionedClass) ?? [])];
  if (matches.length) errors.push(`${rel(file)} still uses version-stamped UI classes: ${matches.join(', ')}`);
}

const iconSource = path.join(srcRoot, 'ui', 'icons.tsx');
if (!fs.existsSync(iconSource)) errors.push('src/ui/icons.tsx is required as the single source for generic interface glyphs.');
const genericGlyphs = ['☰', '◐', '▦', '♪', '◎', '↻', '↗'];
for (const file of walk(srcRoot, new Set(['.tsx']))) {
  if (file === iconSource) continue;
  const source = fs.readFileSync(file, 'utf8');
  const found = genericGlyphs.filter(glyph => source.includes(glyph));
  if (found.length) errors.push(`${rel(file)} defines generic interface glyphs directly (${found.join(' ')}); use UiIcon.`);
}

const cssFiles = walk(stylesRoot, new Set(['.css']));
const gradientOwners = new Set(['buttons.css', 'board.css', 'clock.css', 'skeletons.css', 'animations.css']);
for (const file of cssFiles) {
  const name = path.basename(file);
  const css = fs.readFileSync(file, 'utf8');
  if (css.includes('linear-gradient(') && !gradientOwners.has(name) && name !== 'tokens.css') {
    errors.push(`${rel(file)} invents a gradient outside the approved control/board/clock/loading systems.`);
  }
  if (name !== 'tokens.css' && name !== 'buttons.css') {
    for (const match of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
      const value = match[1].trim();
      if (value === 'none' || value.includes('var(--q-elevation') || value.includes('var(--q-shadow')) continue;
      errors.push(`${rel(file)} contains an ad-hoc shadow: box-shadow:${value}`);
      break;
    }
  }
}

const keyframes = new Map();
let allCss = '';
for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');
  allCss += `\n${css}`;
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)/g)) keyframes.set(match[1], rel(file));
}
for (const [name, file] of keyframes) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const count = (allCss.match(new RegExp(`\\b${escaped}\\b`, 'g')) ?? []).length;
  if (count < 2) errors.push(`${file} defines unused animation @keyframes ${name}.`);
}

const selectors = new Map();
for (const file of cssFiles) {
  const name = path.basename(file);
  if (['tokens.css', 'responsive.css'].includes(name)) continue;
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)) {
    const selector = match[2].trim().replace(/\s+/g, ' ');
    if (!selector || selector.includes('from') || selector.includes('to') || /^\d+%$/.test(selector)) continue;
    const owners = selectors.get(selector) ?? new Set();
    owners.add(rel(file));
    selectors.set(selector, owners);
  }
}
const duplicates = [...selectors.entries()].filter(([, owners]) => owners.size > 1);
if (duplicates.length) {
  notes.push(`Cross-file duplicate selectors to review: ${duplicates.slice(0, 20).map(([selector, owners]) => `${selector} [${[...owners].join(', ')}]`).join(' | ')}`);
}

if (notes.length) {
  console.log('\nQQURZ design audit notes:');
  for (const note of notes) console.log(` - ${note}`);
}

if (errors.length) {
  console.error('\nQQURZ final design-consistency check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('\nKeep screen CSS on the shared tokens, elevations, controls and icon system.\n');
  process.exit(1);
}

console.log('QQURZ design consistency OK: no duplicate app shells, version-stamped UI classes, stray generic icons, unapproved gradients, ad-hoc shadows or unused keyframes.');
