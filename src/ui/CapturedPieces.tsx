type Orientation = 'white' | 'black';

type Props = {
  fen: string;
  orientation?: Orientation;
  compact?: boolean;
};

type PieceKey = 'q' | 'r' | 'b' | 'n' | 'p';

const STARTING: Record<PieceKey, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };
const VALUE: Record<PieceKey, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
const ORDER: PieceKey[] = ['q', 'r', 'b', 'n', 'p'];
const GLYPH = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
} as const;

function currentCounts(fen: string, color: Orientation): Record<PieceKey, number> {
  const result: Record<PieceKey, number> = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  const board = (fen.split(' ')[0] || '').replace(/\//g, '');
  for (const key of ORDER) {
    const token = color === 'white' ? key.toUpperCase() : key;
    result[key] = [...board].filter(char => char === token).length;
  }
  return result;
}

function captured(fen: string, color: Orientation) {
  const current = currentCounts(fen, color);
  return ORDER.flatMap(key => Array.from({ length: Math.max(0, STARTING[key] - current[key]) }, () => key));
}

function material(pieces: PieceKey[]): number {
  return pieces.reduce((total, piece) => total + VALUE[piece], 0);
}

function PieceRun({ pieces, color }: { pieces: PieceKey[]; color: Orientation }) {
  if (!pieces.length) return <span className="captured-empty">No captures</span>;
  return (
    <span className={`captured-glyphs ${color}`} aria-label={`${pieces.length} ${color} pieces captured`}>
      {pieces.map((piece, index) => <span key={`${piece}-${index}`}>{GLYPH[color][piece]}</span>)}
    </span>
  );
}

export default function CapturedPieces({ fen, orientation = 'white', compact = false }: Props) {
  const whiteLost = captured(fen, 'white');
  const blackLost = captured(fen, 'black');
  const whiteScore = material(blackLost);
  const blackScore = material(whiteLost);
  const difference = whiteScore - blackScore;

  const whiteTook = <div className="captured-player white-took"><PieceRun pieces={blackLost} color="black" />{difference > 0 && <b>+{difference}</b>}</div>;
  const blackTook = <div className="captured-player black-took"><PieceRun pieces={whiteLost} color="white" />{difference < 0 && <b>+{Math.abs(difference)}</b>}</div>;

  return (
    <div className={`captured-strip ${compact ? 'compact' : ''}`} aria-label="Captured pieces">
      {orientation === 'white' ? <>{whiteTook}{blackTook}</> : <>{blackTook}{whiteTook}</>}
    </div>
  );
}
