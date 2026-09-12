import fs from 'node:fs';

const rendererFiles = [
  'src/premium/ThreeBoardRenderer.tsx',
  'src/premium/threeScene.ts',
  'src/premium/threeGeometry.ts',
  'src/premium/threePerformance.ts',
];
const forbiddenRendererPatterns = [
  ['chess rules object', /chessops\/chess/],
  ['legal-move generator', /chessops\/compat/],
  ['move parser/executor', /parseUci|makeSan|\.isLegal\s*\(|\.play\s*\(/],
  ['result adjudication', /adjudicateChess|chessPositionKey|appendPositionHistory/],
  ['game controller ownership', /useLocalGameController|useGameSession|dispatchSession/],
  ['AI engine import/call', /(?:from\s+['"][^'"]*engine\/stockfish|import\(\s*['"][^'"]*engine\/stockfish|bestMove\s*\()/i],
  ['network transport', /WebSocket|connectRoom|createRoom|joinRoom|send\s*\(\s*\{\s*type:\s*['"]move/i],
  ['tournament implementation', /tournamentEngine|pairing|standings/i],
];
const errors = [];

for (const file of rendererFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [label, pattern] of forbiddenRendererPatterns) {
    if (pattern.test(source)) errors.push(`${file} contains ${label}; Premium 3D must remain presentation-only.`);
  }
  if (/setAnimationLoop\s*\(|function\s+animate\s*\(/.test(source)) {
    errors.push(`${file} contains a perpetual render loop; Premium 3D must stay demand-driven.`);
  }
}

const boardProjection = fs.readFileSync('src/game/boardViewState.ts', 'utf8');
for (const [label, pattern] of forbiddenRendererPatterns) {
  if (pattern.test(boardProjection) && label !== 'game controller ownership') {
    errors.push(`boardViewState contains ${label}; the shared renderer state must be a projection only.`);
  }
}
if (!/ChessBoardViewState/.test(boardProjection) || !/localBoardViewState/.test(boardProjection)) {
  errors.push('Shared ChessBoardViewState/localBoardViewState projection is missing.');
}

const premiumPage = fs.readFileSync('src/premium/PremiumBoard3D.tsx', 'utf8');
if (!/useLocalGameController/.test(premiumPage)) errors.push('PremiumBoard3D must consume the shared local game controller.');
if (!/localBoardViewState\s*\(\s*game\s*\)/.test(premiumPage)) errors.push('PremiumBoard3D must use the same shared board-state projection as 2D.');
if (!/<ThreeBoardRenderer[^>]*state=\{boardState\}/s.test(premiumPage)) errors.push('PremiumBoard3D must pass the shared boardState object into ThreeBoardRenderer.');
const forbiddenPremiumPagePatterns = [
  ['chess implementation', /chessops\/chess|adjudicateChess|parseUci|makeSan/],
  ['AI engine import', /(?:from\s+['"][^'"]*engine\/stockfish|import\(\s*['"][^'"]*engine\/stockfish)/i],
  ['network implementation', /WebSocket|connectRoom|createRoom|joinRoom|send\s*\(\s*\{\s*type:\s*['"]move/i],
  ['tournament implementation', /tournamentEngine|pairing|standings/i],
];
for (const [label, pattern] of forbiddenPremiumPagePatterns) {
  if (pattern.test(premiumPage)) errors.push(`PremiumBoard3D contains forbidden ${label}; it must stay a presentation surface.`);
}

const local2d = fs.readFileSync('src/LocalGame.tsx', 'utf8');
if (!/useLocalGameController/.test(local2d)) errors.push('LocalGame 2D must consume the shared local game controller as Premium 3D.');
if (!/localBoardViewState\s*\(\s*game\s*\)/.test(local2d)) errors.push('LocalGame 2D must use the same board-state projection as Premium 3D.');
for (const pattern of [/chessops\/chess/, /adjudicateChess/, /(?:from\s+['"][^'"]*engine\/stockfish|import\(\s*['"][^'"]*engine\/stockfish)/i, /parseUci/, /makeSan/]) {
  if (pattern.test(local2d)) errors.push(`LocalGame contains duplicated chess implementation: ${pattern}`);
}

const renderer = fs.readFileSync('src/premium/ThreeBoardRenderer.tsx', 'utf8');
if (!/state:\s*ChessBoardViewState/.test(renderer)) errors.push('ThreeBoardRenderer must accept one ChessBoardViewState object.');
if (/\n\s*fen:\s*string|\n\s*legalDests:\s*Map|\n\s*movableColor\?:/.test(renderer)) {
  errors.push('ThreeBoardRenderer exposes parallel chess-state props instead of the shared state contract.');
}

const scene = fs.readFileSync('src/premium/threeScene.ts', 'utf8');
if (!/new THREE\.InstancedMesh\(squareGeometry, mats\.square, 64\)/.test(scene)) errors.push('3D board squares must remain one instanced draw call.');
if (!/new Map<Role, THREE\.InstancedMesh>/.test(scene)) errors.push('3D pieces must stay instanced by role instead of role+color.');
if (!/mesh\.setColorAt/.test(scene)) errors.push('3D piece colors must remain per-instance so both sides share role meshes.');
if (!/new THREE\.CircleGeometry\(12\.2/.test(scene)) errors.push('3D table should render its visible top surface instead of a closed solid.');
if (!/renderer\.shadowMap\.enabled = !lowPower/.test(scene)) errors.push('Lower-power iPhones must start without shadow maps.');
if (!/IntersectionObserver/.test(scene)) errors.push('Premium 3D must pause when the board is outside the viewport.');

const performance = fs.readFileSync('src/premium/threePerformance.ts', 'utf8');
if (!/cappedPixelRatio/.test(performance) || !/1\.25/.test(performance)) errors.push('Premium 3D must keep an older-iPhone pixel-ratio cap.');
if (!/visibilitychange/.test(performance)) errors.push('Premium 3D must pause when the tab/app becomes hidden.');
if (!/setViewportVisible/.test(performance)) errors.push('Premium 3D scheduler must support viewport visibility pausing.');

if (errors.length) {
  console.error('\nQQURZ Premium 3D boundary check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}
console.log('Premium 3D boundary OK: one shared board state, renderer-only Three.js, instanced low-draw scene, visibility-aware rendering.');
