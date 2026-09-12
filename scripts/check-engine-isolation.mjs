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

const localGame = await readFile(path.join(src, 'LocalGame.tsx'), 'utf8');
if (!localGame.includes("import('./engine/stockfish')")) {
  violations.push('src/LocalGame.tsx must keep Stockfish behind the AI-practice dynamic import boundary.');
}
if (/^import\s+.*engine\/stockfish/m.test(localGame)) {
  violations.push('src/LocalGame.tsx must not statically import Stockfish.');
}

if (violations.length) {
  console.error('Competitive engine isolation check failed:');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}
console.log('Competitive player/tournament sources are isolated from the AI engine bundle.');
