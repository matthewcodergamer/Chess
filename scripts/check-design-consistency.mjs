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

const versionedClass = /\b[\w-]+-v\d+(?:-\d+)?\b/g;
for (const file of walk(srcRoot, new Set(['.tsx']))) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = [...new Set(source.match(versionedClass) ?? [])];
  if (matches.length) errors.push(`${rel(file)} exposes version-stamped UI classes: ${matches.join(', ')}`);
}

const cssFiles = walk(stylesRoot, new Set(['.css']));
const cssVersioned = [];
for (const file of cssFiles) {
  const matches = [...new Set(fs.readFileSync(file, 'utf8').match(versionedClass) ?? [])];
  if (matches.length) cssVersioned.push(`${rel(file)}: ${matches.join(', ')}`);
}
if (cssVersioned.length) notes.push(`Legacy CSS selectors still worth retiring when their owning feature is touched: ${cssVersioned.join(' | ')}`);

const iconSource = path.join(srcRoot, 'ui', 'icons.tsx');
if (!fs.existsSync(iconSource)) errors.push('src/ui/icons.tsx is required as the source for generic interface glyphs.');
const genericGlyphs = ['☰', '◐', '▦', '♪', '◎', '↻', '↗'];
const strayGlyphs = [];
for (const file of walk(srcRoot, new Set(['.tsx']))) {
  if (file === iconSource) continue;
  const source = fs.readFileSync(file, 'utf8');
  const found = genericGlyphs.filter(glyph => source.includes(glyph));
  if (found.length) strayGlyphs.push(`${rel(file)} (${found.join(' ')})`);
}
if (strayGlyphs.length) notes.push(`Generic glyphs remaining outside UiIcon: ${strayGlyphs.join(', ')}`);

const gradientOwners = new Set(['buttons.css', 'board.css', 'clock.css', 'skeletons.css', 'animations.css', 'tokens.css']);
for (const file of cssFiles) {
  const name = path.basename(file);
  const css = fs.readFileSync(file, 'utf8');
  if (/\b(?:linear|radial|conic)-gradient\(/.test(css) && !gradientOwners.has(name)) {
    errors.push(`${rel(file)} invents a gradient outside the approved control/board/clock/loading systems.`);
  }

  if (name !== 'tokens.css' && name !== 'buttons.css') {
    for (const match of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
      const value = match[1].trim();
      if (/^none(?:\s*!important)?$/.test(value)) continue;
      if (value.includes('var(--q-elevation') || value.includes('var(--q-shadow')) continue;
      // Token-driven rings and inset separators are state/focus affordances, not decorative elevation.
      if (!/(?:#|rgba?\()/i.test(value) && /var\(--q-/.test(value)) continue;
      errors.push(`${rel(file)} contains decorative shadow values outside the elevation system: box-shadow:${value}`);
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
  if (['tokens.css', 'responsive.css', 'animations.css', 'accessibility.css'].includes(name)) continue;
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
if (duplicates.length) notes.push(`Cross-feature duplicate selectors to consolidate: ${duplicates.slice(0, 20).map(([selector, owners]) => `${selector} [${[...owners].join(', ')}]`).join(' | ')}`);

if (notes.length) {
  console.log('\nQQURZ design audit notes:');
  for (const note of notes) console.log(` - ${note}`);
}

if (errors.length) {
  console.error('\nQQURZ final design-consistency check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('\nKeep production markup stable and screen CSS on the shared tokens, elevations, controls and motion system.\n');
  process.exit(1);
}

console.log('QQURZ design consistency OK: one application shell, stable production class names, approved gradients/elevation, and no unused animations.');
