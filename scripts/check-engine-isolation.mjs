import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = path.join(root, 'src');
const competitiveRoots = [
  path.join(src, 'multiplayer'),
  path.join(src, 'tournaments'),
];
const forbidden = [
  /(?:from|import\()\s*[('"`].*\/engine\//i,
  /stockfish/i,
  /ai-practice-engine/i,
  /new\s+Worker\s*\([^\n]*stockfish/i,
];

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(full));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) output.push(full);
  }
  return output;
}

const violations = [];
for (const directory of competitiveRoots) {
  for (const file of await filesUnder(directory)) {
    const text = await readFile(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) violations.push(`${path.relative(root, file)} matched ${pattern}`);
    }
  }
}

const controllerPath = path.join(src, 'game', 'useLocalGameController.ts');
const controller = await readFile(controllerPath, 'utf8');
const localGame = await readFile(path.join(src, 'LocalGame.tsx'), 'utf8');
const premium3d = await readFile(path.join(src, 'premium', 'PremiumBoard3D.tsx'), 'utf8');

if (!controller.includes("import('../engine/stockfish')")) {
  violations.push('src/game/useLocalGameController.ts must keep Stockfish behind the AI-practice dynamic import boundary.');
}
if (/^import\s+.*engine\/stockfish/m.test(controller)) {
  violations.push('Shared local game controller must not statically import Stockfish.');
}
if (!localGame.includes('useLocalGameController')) {
  violations.push('src/LocalGame.tsx must consume the shared local controller instead of owning an AI engine path.');
}
if (!premium3d.includes('useLocalGameController')) {
  violations.push('src/premium/PremiumBoard3D.tsx must consume the shared local controller instead of owning an AI engine path.');
}
for (const [label, source] of [['src/LocalGame.tsx', localGame], ['src/premium/PremiumBoard3D.tsx', premium3d]]) {
  if (/engine\/stockfish|new\s+Worker\s*\([^\n]*stockfish/i.test(source)) violations.push(`${label} must not import or instantiate Stockfish directly.`);
}

if (violations.length) {
  console.error('Competitive engine isolation check failed:');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}
console.log('Competitive player/tournament sources are isolated from the AI engine bundle; local 2D and Premium 3D share the lazy AI controller.');
