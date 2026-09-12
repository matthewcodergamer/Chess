import type { Color, Key } from '@lichess-org/chessground/types';
import type { LocalGameController } from './useLocalGameController';

/**
 * Renderer-facing chess state.
 *
 * This is deliberately a projection of the authoritative/shared game
 * controller. A renderer can display this state and emit a square-to-square
 * intent, but it does not own move legality, clocks, results, AI, networking,
 * tournament policy, or any other chess rule.
 */
export type ChessBoardViewState = Readonly<{
  fen: string;
  orientation: Color;
  turnColor: Color;
  check: boolean;
  lastMove?: readonly [Key, Key];
  movableColor?: Color;
  legalDests: ReadonlyMap<Key, readonly Key[]>;
}>;

type LocalBoardSource = Pick<
  LocalGameController,
  'fen' | 'orientation' | 'movableColor' | 'legalDests' | 'lastMove' | 'session'
>;

export function localBoardViewState(game: LocalBoardSource): ChessBoardViewState {
  return {
    fen: game.fen,
    orientation: game.orientation,
    turnColor: game.session.sideToMove,
    check: game.session.check,
    lastMove: game.lastMove,
    movableColor: game.movableColor,
    legalDests: game.legalDests as ReadonlyMap<Key, readonly Key[]>,
  };
}
