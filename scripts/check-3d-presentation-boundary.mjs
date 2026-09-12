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
}

const premiumPage = fs.readFileSync('src/premium/PremiumBoard3D.tsx', 'utf8');
if (!/useLocalGameController/.test(premiumPage)) errors.push('PremiumBoard3D must consume the shared local game controller.');
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
if (!/useLocalGameController/.test(local2d)) errors.push('LocalGame 2D must consume the same shared local game controller as Premium 3D.');
for (const pattern of [/chessops\/chess/, /adjudicateChess/, /(?:from\s+['"][^'"]*engine\/stockfish|import\(\s*['"][^'"]*engine\/stockfish)/i, /parseUci/, /makeSan/]) {
  if (pattern.test(local2d)) errors.push(`LocalGame contains duplicated chess implementation: ${pattern}`);
}

if (errors.length) {
  console.error('\nQQURZ Premium 3D boundary check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}
console.log('Premium 3D boundary OK: shared chess controller, presentation-only renderer, no network/tournament fork.');
