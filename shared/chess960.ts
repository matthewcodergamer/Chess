export type Chess960FenStyle = 'shredder' | 'xfen';

const KNIGHT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [0, 3], [0, 4], [1, 2],
  [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
];

const FILES = 'abcdefgh';
const UINT32_RANGE = 0x1_0000_0000;
const UNBIASED_LIMIT = Math.floor(UINT32_RANGE / 960) * 960;

/** Scharnagl / Chess960 numbering. Position 518 is traditional chess. */
export function chess960BackRank(positionId: number): string {
  if (!Number.isInteger(positionId) || positionId < 0 || positionId > 959) {
    throw new RangeError('Chess960 position ID must be an integer from 0 through 959.');
  }

  let n = positionId;
  const rank: Array<string | null> = Array(8).fill(null);

  // Scharnagl: one bishop on an odd file and one on an even file.
  rank[(n % 4) * 2 + 1] = 'B';
  n = Math.floor(n / 4);
  rank[(n % 4) * 2] = 'B';
  n = Math.floor(n / 4);

  let empty = rank.map((piece, file) => piece === null ? file : -1).filter(file => file >= 0);
  rank[empty[n % 6]] = 'Q';
  n = Math.floor(n / 6);

  empty = rank.map((piece, file) => piece === null ? file : -1).filter(file => file >= 0);
  const [firstKnight, secondKnight] = KNIGHT_PAIRS[n % 10];
  rank[empty[firstKnight]] = 'N';
  rank[empty[secondKnight]] = 'N';

  empty = rank.map((piece, file) => piece === null ? file : -1).filter(file => file >= 0);
  rank[empty[0]] = 'R';
  rank[empty[1]] = 'K';
  rank[empty[2]] = 'R';

  return rank.join('');
}

export function isValidChess960BackRank(value: string): boolean {
  const rank = value.toUpperCase();
  if (!/^[RNBQK]{8}$/.test(rank)) return false;
  if ([...rank].filter(piece => piece === 'K').length !== 1) return false;
  if ([...rank].filter(piece => piece === 'Q').length !== 1) return false;
  if ([...rank].filter(piece => piece === 'R').length !== 2) return false;
  if ([...rank].filter(piece => piece === 'B').length !== 2) return false;
  if ([...rank].filter(piece => piece === 'N').length !== 2) return false;

  const bishops = [...rank].map((piece, file) => piece === 'B' ? file : -1).filter(file => file >= 0);
  if ((bishops[0] & 1) === (bishops[1] & 1)) return false;

  const king = rank.indexOf('K');
  const rooks = [...rank].map((piece, file) => piece === 'R' ? file : -1).filter(file => file >= 0);
  return rooks[0] < king && king < rooks[1];
}

let backRankToId: Map<string, number> | null = null;

export function chess960PositionId(backRank: string): number {
  const normalized = backRank.toUpperCase();
  if (!isValidChess960BackRank(normalized)) throw new RangeError('Invalid Chess960 back rank.');
  if (!backRankToId) {
    backRankToId = new Map<string, number>();
    for (let id = 0; id < 960; id += 1) backRankToId.set(chess960BackRank(id), id);
  }
  const id = backRankToId.get(normalized);
  if (id === undefined) throw new Error('Valid Chess960 back rank is missing from the Scharnagl mapping.');
  return id;
}

export function chess960RookFiles(backRank: string): { queenSide: number; kingSide: number } {
  const rank = backRank.toUpperCase();
  if (!isValidChess960BackRank(rank)) throw new RangeError('Invalid Chess960 back rank.');
  const king = rank.indexOf('K');
  const rooks = [...rank].map((piece, file) => piece === 'R' ? file : -1).filter(file => file >= 0);
  const queenSide = rooks.find(file => file < king);
  const kingSide = rooks.find(file => file > king);
  if (queenSide === undefined || kingSide === undefined) throw new Error('Chess960 king must start between both rooks.');
  return { queenSide, kingSide };
}

export function chess960InitialCastlingField(backRank: string, style: Chess960FenStyle = 'shredder'): string {
  if (style === 'xfen') return 'KQkq';
  const { queenSide, kingSide } = chess960RookFiles(backRank);
  return `${FILES[kingSide].toUpperCase()}${FILES[queenSide].toUpperCase()}${FILES[kingSide]}${FILES[queenSide]}`;
}

/** Initial Chess960 FEN. Shredder-FEN is the default because rook files are explicit. */
export function chess960Fen(positionId: number, style: Chess960FenStyle = 'shredder'): string {
  const white = chess960BackRank(positionId);
  const black = white.toLowerCase();
  const castling = chess960InitialCastlingField(white, style);
  return `${black}/pppppppp/8/8/8/8/PPPPPPPP/${white} w ${castling} - 0 1`;
}

/** Uniform selection when Web Crypto is available; avoids uint32 modulo bias. */
export function randomChess960Id(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const value = new Uint32Array(1);
    do crypto.getRandomValues(value); while (value[0] >= UNBIASED_LIMIT);
    return value[0] % 960;
  }
  return Math.floor(Math.random() * 960);
}
