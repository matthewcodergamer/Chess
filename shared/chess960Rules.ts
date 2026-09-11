import { Chess } from 'chessops/chess';
import { makeBoardFen, makeFen, parseFen } from 'chessops/fen';
import type { Color } from 'chessops/types';
import { makeSquare, squareFile, squareRank } from 'chessops/util';
import type { Chess960FenStyle } from './chess960';

export type ChessAdjudication = {
  kind: 'CHECKMATE' | 'DRAW';
  text: string;
  winner: Color | null;
};

/**
 * Canonical repetition identity: board, side to move, castling rights and
 * only a legally capturable en-passant square. chessops' toSetup() already
 * filters phantom en-passant squares, while makeFen(..., { epd: true })
 * omits move counters.
 */
export function chessPositionKey(position: Chess): string {
  return makeFen(position.toSetup(), { epd: true });
}

export function chessPositionKeyFromFen(fen: string): string {
  return chessPositionKey(Chess.fromSetup(parseFen(fen).unwrap()).unwrap());
}

export function appendPositionHistory(history: readonly string[], position: Chess): string[] {
  // With the fifty-move rule, keeping 512 plies is comfortably beyond every
  // reversible-move window while bounding persisted room state.
  return [...history, chessPositionKey(position)].slice(-512);
}

export function repetitionCount(history: readonly string[], position: Chess): number {
  const key = chessPositionKey(position);
  let count = 0;
  for (const item of history) if (item === key) count += 1;
  return count;
}

/**
 * QQURZ auto-adjudicates claimable 3-fold/50-move draws, matching common
 * online-chess behavior. Fivefold repetition and 75 moves are also handled
 * as automatic draws. Checkmate takes precedence on the final move.
 */
export function adjudicateChess(position: Chess, history: readonly string[]): ChessAdjudication | null {
  if (position.isCheckmate()) {
    const winner: Color = position.turn === 'white' ? 'black' : 'white';
    return { kind: 'CHECKMATE', text: `${winner === 'white' ? 'White' : 'Black'} wins by checkmate`, winner };
  }
  if (position.isStalemate()) return { kind: 'DRAW', text: 'Draw by stalemate', winner: null };
  if (position.isInsufficientMaterial()) return { kind: 'DRAW', text: 'Draw by insufficient material', winner: null };

  const repeats = repetitionCount(history, position);
  if (repeats >= 5) return { kind: 'DRAW', text: 'Draw by fivefold repetition', winner: null };
  if (position.halfmoves >= 150) return { kind: 'DRAW', text: 'Draw by seventy-five-move rule', winner: null };
  if (repeats >= 3) return { kind: 'DRAW', text: 'Draw by threefold repetition', winner: null };
  if (position.halfmoves >= 100) return { kind: 'DRAW', text: 'Draw by fifty-move rule', winner: null };
  if (position.isEnd()) return { kind: 'DRAW', text: 'Game over', winner: null };
  return null;
}

function shredderCastlingField(position: Chess): string {
  const setup = position.toSetup();
  const files = 'abcdefgh';
  let field = '';

  for (const color of ['white', 'black'] as const) {
    const rank = color === 'white' ? 0 : 7;
    const king = setup.board.kingOf(color);
    if (king === undefined || squareRank(king) !== rank) continue;
    const rights = [...setup.castlingRights]
      .filter(square => squareRank(square) === rank)
      .sort((a, b) => b - a);
    for (const rook of rights) {
      const letter = files[squareFile(rook)];
      field += color === 'white' ? letter.toUpperCase() : letter;
    }
  }

  return field || '-';
}

/**
 * Serialize any live Chess960 position either as chessops' canonical X-FEN
 * compatible form or with explicit Shredder-FEN rook-file rights.
 */
export function serializeChess960Fen(position: Chess, style: Chess960FenStyle = 'xfen'): string {
  if (style === 'xfen') return makeFen(position.toSetup());
  const setup = position.toSetup();
  return [
    makeBoardFen(setup.board),
    setup.turn[0],
    shredderCastlingField(position),
    setup.epSquare === undefined ? '-' : makeSquare(setup.epSquare),
    Math.max(0, Math.min(setup.halfmoves, 9999)),
    Math.max(1, Math.min(setup.fullmoves, 9999)),
  ].join(' ');
}

export function parseChess960Fen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}
