/**
 * Scharnagl / Chess960 position numbering.
 * Position 518 is the traditional chess starting position.
 */

const knightPairs: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 3],
  [2, 4],
  [3, 4],
];

export function chess960BackRank(positionId: number): string {
  if (!Number.isInteger(positionId) || positionId < 0 || positionId > 959) {
    throw new RangeError('Chess960 position ID must be an integer from 0 to 959.');
  }

  let n = positionId;
  const rank: Array<string | null> = Array(8).fill(null);

  // Bishops are forced onto opposite-colored squares.
  const lightBishop = (n % 4) * 2 + 1;
  rank[lightBishop] = 'B';
  n = Math.floor(n / 4);

  const darkBishop = (n % 4) * 2;
  rank[darkBishop] = 'B';
  n = Math.floor(n / 4);

  // Queen occupies one of the six remaining files.
  let empty = rank.map((piece, index) => (piece === null ? index : -1)).filter(index => index >= 0);
  rank[empty[n % 6]] = 'Q';
  n = Math.floor(n / 6);

  // Knights occupy one of the ten combinations of two among five files.
  empty = rank.map((piece, index) => (piece === null ? index : -1)).filter(index => index >= 0);
  const [firstKnight, secondKnight] = knightPairs[n % 10];
  rank[empty[firstKnight]] = 'N';
  rank[empty[secondKnight]] = 'N';

  // The remaining files are R-K-R, guaranteeing the king starts between both rooks.
  empty = rank.map((piece, index) => (piece === null ? index : -1)).filter(index => index >= 0);
  rank[empty[0]] = 'R';
  rank[empty[1]] = 'K';
  rank[empty[2]] = 'R';

  return rank.join('');
}

export function chess960Fen(positionId: number): string {
  const whiteBackRank = chess960BackRank(positionId);
  const blackBackRank = whiteBackRank.toLowerCase();

  // Shredder-FEN castling rights identify the actual starting rook files,
  // keeping Chess960 castling unambiguous across compatible tools.
  const files = 'abcdefgh';
  const kingFile = whiteBackRank.indexOf('K');
  const rookFiles = [...whiteBackRank]
    .map((piece, file) => piece === 'R' ? file : -1)
    .filter(file => file >= 0);
  const aSideRook = rookFiles.find(file => file < kingFile);
  const hSideRook = rookFiles.find(file => file > kingFile);

  if (aSideRook === undefined || hSideRook === undefined) {
    throw new Error('Invalid Chess960 back rank: king must start between both rooks.');
  }

  const castlingRights =
    files[hSideRook].toUpperCase() +
    files[aSideRook].toUpperCase() +
    files[hSideRook] +
    files[aSideRook];

  return `${blackBackRank}/pppppppp/8/8/8/8/PPPPPPPP/${whiteBackRank} w ${castlingRights} - 0 1`;
}

export function randomChess960Id(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] % 960;
  }
  return Math.floor(Math.random() * 960);
}
