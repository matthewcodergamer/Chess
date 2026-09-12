import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const dist = path.join(root, 'dist');
const manifestPath = path.join(dist, '.vite', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Performance budget check requires Vite manifest at dist/.vite/manifest.json.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = Object.entries(manifest);
const errors = [];
const KiB = 1024;

function keyForSource(source) {
  const hit = entries.find(([, item]) => item.src === source) ?? entries.find(([key]) => key === source || key.endsWith(source));
  return hit?.[0] ?? null;
}

function staticClosure(startKey) {
  const seen = new Set();
  const visit = key => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    const item = manifest[key];
    for (const dep of item?.imports ?? []) visit(dep);
  };
  visit(startKey);
  return seen;
}

function gzipBytes(file) {
  const full = path.join(dist, file);
  if (!fs.existsSync(full)) return 0;
  return zlib.gzipSync(fs.readFileSync(full), { level: 9 }).byteLength;
}

function measure(keys) {
  const files = new Set();
  const css = new Set();
  for (const key of keys) {
    const item = manifest[key];
    if (!item) continue;
    if (item.file) files.add(item.file);
    for (const file of item.css ?? []) css.add(file);
  }
  let jsGzip = 0;
  let cssGzip = 0;
  for (const file of files) if (file.endsWith('.js')) jsGzip += gzipBytes(file);
  for (const file of css) cssGzip += gzipBytes(file);
  return { jsGzip, cssGzip, totalGzip: jsGzip + cssGzip, files, css };
}

function format(bytes) { return `${(bytes / KiB).toFixed(1)} KiB`; }
function requireBudget(label, actual, max) {
  if (actual > max) errors.push(`${label}: ${format(actual)} exceeds ${format(max)}.`);
}

const mainKey = entries.find(([, item]) => item.isEntry)?.[0] ?? keyForSource('src/main.tsx');
if (!mainKey) errors.push('Could not find main Vite entry in manifest.');

const initialKeys = staticClosure(mainKey);
const initial = measure(initialKeys);
requireBudget('Initial JavaScript gzip', initial.jsGzip, 96 * KiB);
requireBudget('Initial CSS gzip', initial.cssGzip, 34 * KiB);
requireBudget('Initial JS+CSS gzip', initial.totalGzip, 135 * KiB);

const routeBudgets = [
  ['Account', 'src/profile/ProfileHub.tsx', 16],
  ['Tournament', 'src/tournaments/TournamentHub.tsx', 28],
  ['Local 2D', 'src/LocalGame.tsx', 36],
  ['Online arena', 'src/multiplayer/OnlineArena.tsx', 52],
  ['Premium gate', 'src/premium/Premium3DGate.tsx', 12],
  ['Premium 3D', 'src/premium/PremiumBoard3D.tsx', 190],
];

for (const [label, source, maxKiB] of routeBudgets) {
  const key = keyForSource(source);
  if (!key) {
    errors.push(`${label}: missing dynamic chunk for ${source}.`);
    continue;
  }
  if (initialKeys.has(key)) errors.push(`${label}: ${source} leaked into the initial static closure.`);
  const incrementalKeys = new Set([...staticClosure(key)].filter(dep => !initialKeys.has(dep)));
  const measured = measure(incrementalKeys);
  requireBudget(`${label} route gzip`, measured.totalGzip, maxKiB * KiB);
  console.log(`${label.padEnd(14)} ${format(measured.totalGzip).padStart(10)} gzip`);
}

const localKey = keyForSource('src/LocalGame.tsx');
const localKeys = localKey ? staticClosure(localKey) : new Set();
const onlineKey = keyForSource('src/multiplayer/OnlineArena.tsx');
const onlineKeys = onlineKey ? staticClosure(onlineKey) : new Set();
const forbiddenInitial = [
  ['Stockfish adapter', 'src/engine/stockfish.ts'],
  ['Premium 3D board', 'src/premium/PremiumBoard3D.tsx'],
  ['3D physical clock', 'src/ui/ChessClock3DView.tsx'],
];
for (const [label, source] of forbiddenInitial) {
  const key = keyForSource(source);
  if (key && initialKeys.has(key)) errors.push(`${label} must not be in the initial shell static closure.`);
  if (key && localKeys.has(key)) errors.push(`${label} must not block the LocalGame 2D static closure.`);
}

const onlineThreeSources = [
  ['Animated quarter', 'src/ui/Quarter3D.tsx'],
  ['3D physical clock', 'src/ui/ChessClock3DView.tsx'],
];
for (const [label, source] of onlineThreeSources) {
  const key = keyForSource(source);
  if (key && onlineKeys.has(key)) errors.push(`${label} must not block the OnlineArena 2D static closure.`);
}

const mustBeDynamic = [
  'src/profile/ProfileHub.tsx',
  'src/tournaments/TournamentHub.tsx',
  'src/premium/Premium3DGate.tsx',
];
for (const source of mustBeDynamic) {
  const key = keyForSource(source);
  if (!key) errors.push(`${source} has no separate manifest chunk.`);
  else if (initialKeys.has(key)) errors.push(`${source} must stay lazy-loaded.`);
}

console.log(`Initial shell  JS ${format(initial.jsGzip)} · CSS ${format(initial.cssGzip)} · total ${format(initial.totalGzip)} gzip`);

if (errors.length) {
  console.error('\nQQURZ performance budgets failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}
console.log('QQURZ performance budgets OK: fast shell, lazy routes, AI/3D isolated from 2D startup.');
