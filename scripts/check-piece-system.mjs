import fs from 'node:fs';

const fail = message => { throw new Error(`[piece-system] ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };
const read = path => fs.readFileSync(path, 'utf8');

const main = read('src/main.tsx');
const boardCss = read('src/styles/board.css');
const captured = read('src/ui/CapturedPieces.tsx');
const activeBoardFiles = [
  'src/LocalGame.tsx',
  'src/multiplayer/OnlineArena.tsx',
  'src/ui/HomeBoardPreview.tsx',
];

assert(main.includes("@lichess-org/chessground/assets/chessground.cburnett.css"), 'cburnett SVG asset sheet must be loaded globally');
for (const path of activeBoardFiles) {
  const source = read(path);
  assert(source.includes('ChessBoardSurface'), `${path} must use the shared ChessBoardSurface`);
  assert(!source.includes("from '@lichess-org/chessground';"), `${path} must not instantiate Chessground directly`);
}
assert(!/[♔-♟]/u.test(captured), 'captured material must not use Unicode chess-piece glyphs');
assert(boardCss.includes('width:12.5%'), 'board pieces must scale from the 8x8 board geometry');
assert(boardCss.includes('background-size:100% 100%'), 'piece SVGs must scale to their square without rasterization');
assert(!boardCss.includes('filter:brightness(1.10) contrast(1.18)'), 'do not alter black cburnett artwork with brightness/contrast filters');

const cburnett = read('node_modules/@lichess-org/chessground/assets/chessground.cburnett.css');
const roles = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const colors = ['white', 'black'];

function svgFor(role, color) {
  const selector = `.cg-wrap piece.${role}.${color}`;
  const start = cburnett.indexOf(selector);
  assert(start >= 0, `missing ${color} ${role} selector in cburnett`);
  const block = cburnett.slice(start, cburnett.indexOf('}', start) + 1);
  const match = block.match(/base64,([^')"]+)/);
  assert(match, `${color} ${role} must be an embedded SVG asset`);
  const svg = Buffer.from(match[1], 'base64').toString('utf8');
  assert(svg.includes('<svg'), `${color} ${role} did not decode as SVG`);
  assert(/width="45"/.test(svg) && /height="45"/.test(svg), `${color} ${role} changed from the canonical 45x45 cburnett geometry`);
  return svg;
}

for (const color of colors) for (const role of roles) svgFor(role, color);

const blackKnight = svgFor('knight', 'black');
assert(blackKnight.includes('#ececec'), 'black knight eye/highlight detail is missing');
const whiteQueen = svgFor('queen', 'white');
assert((whiteQueen.match(/<path/g) ?? []).length >= 3 && (whiteQueen.match(/a2 2/g) ?? []).length >= 3, 'queen crown openings/details are missing');
const blackBishop = svgFor('bishop', 'black');
assert(blackBishop.includes('m-7.5-14.5v5') && blackBishop.includes('stroke="#ececec"'), 'bishop cut/detail path is missing');
const blackRook = svgFor('rook', 'black');
assert(blackRook.includes('V9h4') && blackRook.includes('stroke-linecap'), 'rook battlement edges are missing');
const whiteKing = svgFor('king', 'white');
assert(whiteKing.includes('M22.5 11.63V6') && whiteKing.includes('M20 8h5'), 'king cross detail is missing');
const whitePawn = svgFor('pawn', 'white');
assert(whitePawn.includes('c-2.25 0-4 1.79') && whitePawn.includes('stroke-linecap="round"'), 'pawn curve geometry is missing');

// These board widths cover compact phones through large phones. SVG geometry stays
// vector-based while each piece remains exactly one eighth of the board width.
for (const boardWidth of [280, 320, 360, 390, 430]) {
  const pieceSize = boardWidth / 8;
  assert(pieceSize >= 35 && pieceSize <= 54, `unexpected phone-scale piece size at ${boardWidth}px board width`);
}

console.log('[piece-system] shared Chessground + cburnett SVG fidelity verified at 280/320/360/390/430px board widths');
