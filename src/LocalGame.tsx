import { useCallback, useMemo, useRef, useState } from 'react';
import type { Key } from '@lichess-org/chessground/types';
import ChessBoardSurface, { type QQurzChessgroundApi, type QQurzChessgroundConfig } from './ui/ChessBoardSurface';
import { motionTokenMs, useReducedMotion } from './ui/motion';
import LocalGameSetup from './game/LocalGameSetup';
import LocalMatchChrome from './game/LocalMatchChrome';
import LocalPromotionDialog from './game/LocalPromotionDialog';
import { useLocalGameController, type LocalGameMode } from './game/useLocalGameController';

type Props = { initialMode: LocalGameMode };

export default function LocalGame({ initialMode }: Props) {
  const game = useLocalGameController(initialMode);
  const ground = useRef<QQurzChessgroundApi | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});
  const [optionsOpen, setOptionsOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const pieceMotionMs = reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 160);
  moveHandler.current = game.boardMove;

  const syncBoard = useCallback(() => {
    const api = ground.current;
    if (!api) return;
    const canMove = Boolean(game.movableColor);
    api.set({
      fen: game.fen,
      orientation: game.orientation,
      turnColor: game.session.sideToMove,
      check: game.session.check,
      lastMove: game.lastMove,
      animation: { enabled: !reducedMotion, duration: pieceMotionMs },
      draggable: { enabled: canMove, showGhost: true, autoDistance: true },
      selectable: { enabled: canMove },
      movable: {
        free: false,
        color: game.movableColor,
        dests: game.legalDests,
        rookCastle: true,
        showDests: true,
      },
    });
  }, [game.fen, game.legalDests, game.lastMove, game.movableColor, game.orientation, game.session.check, game.session.sideToMove, pieceMotionMs, reducedMotion]);

  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: game.fen,
    orientation: game.orientation,
    coordinates: true,
    coordinatesOnSquares: true,
    autoCastle: true,
    blockTouchScroll: true,
    disableContextMenu: true,
    movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
  }), [game.fen, game.orientation]);

  if (game.phase === 'setup') return <LocalGameSetup game={game} />;

  const board = <ChessBoardSurface apiRef={ground} instanceKey={game.positionId ?? 'local'} config={boardConfig} ariaLabel="Interactive Chess960 board" onReady={syncBoard} />;
  return <><LocalMatchChrome game={game} board={board} optionsOpen={optionsOpen} onToggleOptions={() => setOptionsOpen(value => !value)} /><LocalPromotionDialog game={game} /></>;
}
