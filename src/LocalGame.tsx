import { useMemo, useRef, useState } from 'react';
import type { Key } from '@lichess-org/chessground/types';
import ChessBoardSurface, { type QQurzChessgroundConfig } from './ui/ChessBoardSurface';
import { motionTokenMs, useReducedMotion } from './ui/motion';
import LocalGameSetup from './game/LocalGameSetup';
import LocalMatchChrome from './game/LocalMatchChrome';
import LocalPromotionDialog from './game/LocalPromotionDialog';
import { localBoardViewState } from './game/boardViewState';
import { useLocalGameController, type LocalGameMode } from './game/useLocalGameController';

type Props = { initialMode: LocalGameMode };

export default function LocalGame({ initialMode }: Props) {
  const game = useLocalGameController(initialMode);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});
  const [optionsOpen, setOptionsOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const pieceMotionMs = reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 160);
  moveHandler.current = game.boardMove;

  const boardState = useMemo(
    () => localBoardViewState(game),
    [game.fen, game.legalDests, game.lastMove, game.movableColor, game.orientation, game.session.check, game.session.sideToMove],
  );

  const boardConfig = useMemo<QQurzChessgroundConfig>(() => {
    const canMove = Boolean(boardState.movableColor);
    return {
      fen: boardState.fen,
      orientation: boardState.orientation,
      turnColor: boardState.turnColor,
      check: boardState.check,
      lastMove: boardState.lastMove ? [...boardState.lastMove] as [Key, Key] : undefined,
      coordinates: true,
      coordinatesOnSquares: true,
      autoCastle: true,
      blockTouchScroll: true,
      disableContextMenu: true,
      animation: { enabled: !reducedMotion, duration: pieceMotionMs },
      draggable: { enabled: canMove, showGhost: true, autoDistance: true },
      selectable: { enabled: canMove },
      movable: {
        free: false,
        color: boardState.movableColor,
        dests: boardState.legalDests as Map<Key, Key[]>,
        rookCastle: true,
        showDests: true,
        events: { after: (orig, dest) => moveHandler.current(orig, dest) },
      },
    };
  }, [boardState, pieceMotionMs, reducedMotion]);

  if (game.phase === 'setup') return <LocalGameSetup game={game} />;

  const board = <ChessBoardSurface instanceKey={game.positionId ?? 'local'} config={boardConfig} ariaLabel="Interactive Chess960 board" />;
  return <><LocalMatchChrome game={game} board={board} optionsOpen={optionsOpen} onToggleOptions={() => setOptionsOpen(value => !value)} /><LocalPromotionDialog game={game} /></>;
}
