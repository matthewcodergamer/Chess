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

  const lightBishop = (n % 4) * 2 + 1;
  rank[lightBishop] = 'B';
  n = Math.floor(n / 4);

  const darkBishop = (n % 4) * 2;
  rank[darkBishop] = 'B';
  n = Math.floor(n / 4);

  let empty = rank.map((piece, index) => (piece === null ? index : -1)).filter(index => index >= 0);
  rank[empty[n % 6]] = 'Q';
  n = Math.floor(n / 6);

  empty = rank.map((piece, index) => (piece === null ? index : -1)).filter(index => index >= 0);
  const [firstKnight, secondKnight] = knightPairs[n % 10];
  rank[empty[firstKnight]] = 'N';
  rank[empty[secondKnight]] = 'N';

  empty = rank.map((piece, index) => (piece === null ? index : -1)).filter(index => index >= 0);
  rank[empty[0]] = 'R';
  rank[empty[1]] = 'K';
  rank[empty[2]] = 'R';

  return rank.join('');
}

export function chess960Fen(positionId: number): string {
  const whiteBackRank = chess960BackRank(positionId);
  const blackBackRank = whiteBackRank.toLowerCase();
  return `${blackBackRank}/pppppppp/8/8/8/8/PPPPPPPP/${whiteBackRank} w KQkq - 0 1`;
}

export function randomChess960Id(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] % 960;
  }
  return Math.floor(Math.random() * 960);
}
