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

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function requireText(violations, file, text, expected, reason) {
  if (!text.includes(expected)) violations.push(`${file}: ${reason}`);
}

function forbidText(violations, file, text, pattern, reason) {
  if (pattern.test(text)) violations.push(`${file}: ${reason}`);
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

const sharedSession = await source('shared/gameSession.ts');
const sharedRules = await source('shared/chess960Rules.ts');
const controller = await source('src/game/useLocalGameController.ts');
const gameSessionHook = await source('src/game/useGameSession.ts');
const localGame = await source('src/LocalGame.tsx');
const premium3d = await source('src/premium/PremiumBoard3D.tsx');
const serverRoom = await source('server/src/index.ts');
const onlineArena = await source('src/multiplayer/OnlineArena.tsx');
const onlineSession = await source('src/multiplayer/session.ts');
const homePreview = await source('src/ui/HomeBoardPreview.tsx');

// AI isolation: Stockfish may choose a local practice move, but it may not own
// competitive state or become a dependency of competitive player surfaces.
requireText(
  violations,
  'src/game/useLocalGameController.ts',
  controller,
  "import('../engine/stockfish')",
  'must keep Stockfish behind the AI-practice dynamic import boundary.',
);
forbidText(
  violations,
  'src/game/useLocalGameController.ts',
  controller,
  /^import\s+.*engine\/stockfish/m,
  'must not statically import Stockfish.',
);
if (!localGame.includes('useLocalGameController')) {
  violations.push('src/LocalGame.tsx must consume the shared local controller instead of owning an AI/game-state path.');
}
if (!premium3d.includes('useLocalGameController')) {
  violations.push('src/premium/PremiumBoard3D.tsx must consume the shared local controller instead of owning an AI/game-state path.');
}
for (const [label, text] of [['src/LocalGame.tsx', localGame], ['src/premium/PremiumBoard3D.tsx', premium3d]]) {
  if (/engine\/stockfish|new\s+Worker\s*\([^\n]*stockfish/i.test(text)) {
    violations.push(`${label} must not import or instantiate Stockfish directly.`);
  }
}

// One chess/game state model, many presentations. shared/gameSession.ts is the
// lifecycle/clock/result contract used by both local React state and the
// authoritative Worker. shared/chess960Rules.ts owns shared adjudication helpers.
for (const marker of ['export type GameSessionModel', 'export function reduceGameSession', 'export function clockOwner']) {
  requireText(violations, 'shared/gameSession.ts', sharedSession, marker, `must remain the canonical game-session owner (${marker}).`);
}
requireText(
  violations,
  'src/game/useGameSession.ts',
  gameSessionHook,
  "from '../../shared/gameSession'",
  'must adapt the shared game-session reducer rather than define a local state machine.',
);
for (const [needle, reason] of [
  ["from '../../shared/gameSession'", 'must consume the canonical game-session model.'],
  ["from '../../shared/chess960Rules'", 'must consume the canonical Chess960 adjudication helpers.'],
  ["from './useGameSession'", 'must drive local/AI play through the shared session reducer.'],
]) {
  requireText(violations, 'src/game/useLocalGameController.ts', controller, needle, reason);
}
for (const [needle, reason] of [
  ["from '../../shared/gameSession'", 'must use the same canonical session model as the client.'],
  ["from '../../shared/chess960Rules'", 'must use the same canonical Chess960 adjudication helpers as local play.'],
]) {
  requireText(violations, 'server/src/index.ts', serverRoom, needle, reason);
}
requireText(
  violations,
  'src/multiplayer/session.ts',
  onlineSession,
  "from '../../shared/gameSession'",
  'must project authoritative room snapshots into the canonical GameSessionModel.',
);
requireText(
  violations,
  'src/multiplayer/OnlineArena.tsx',
  onlineArena,
  "from './session'",
  'must consume the authoritative room-session projection instead of defining a second online game state model.',
);
requireText(
  violations,
  'src/multiplayer/OnlineArena.tsx',
  onlineArena,
  "from '../../shared/gameSession'",
  'must derive move/leave/draw/resign/clock permissions from the shared session contract.',
);
requireText(
  violations,
  'src/ui/HomeBoardPreview.tsx',
  homePreview,
  "from './ChessBoardSurface'",
  'must use the shared 2D board presentation rather than a homepage-only fake board implementation.',
);
forbidText(
  violations,
  'src/ui/HomeBoardPreview.tsx',
  homePreview,
  /from ['"](?:chessops|@lichess-org\/chessground)['"]|new\s+Chessground/i,
  'must remain a read-only projection and not grow its own rules/board-engine path.',
);
forbidText(
  violations,
  'src/premium/PremiumBoard3D.tsx',
  premium3d,
  /from ['"].*shared\/gameSession['"]|from ['"]chessops\//i,
  'must remain a presentation over useLocalGameController rather than instantiate a parallel rules/session model.',
);

// Shared rule helpers are expected to be rule/data logic, not UI or AI logic.
// Match actual UI/renderer imports rather than English words such as "threefold".
forbidText(
  violations,
  'shared/chess960Rules.ts',
  sharedRules,
  /(?:from\s+['"](?:react|react-dom|three|@react-three\/[^'"]+|@lichess-org\/chessground)['"]|import\(\s*['"](?:react|react-dom|three|@react-three\/[^'"]+|@lichess-org\/chessground)['"]\s*\)|stockfish)/i,
  'must stay presentation- and AI-independent.',
);

if (violations.length) {
  console.error('Shared chess architecture / engine-isolation check failed:');
  for (const violation of violations) console.error(` - ${violation}`);
  console.error('\nRule: one canonical game state/rules model, many presentations.\n');
  process.exit(1);
}
console.log('Shared chess architecture OK: local 2D, Premium 3D and online/server flows preserve one canonical game-session/rules model; competitive sources remain isolated from Stockfish.');
