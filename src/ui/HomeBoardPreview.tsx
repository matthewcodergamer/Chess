import { useMemo } from 'react';
import { chess960Fen } from '../game/chess960';
import { motionTokenMs, useReducedMotion } from './motion';
import ChessBoardSurface, { type QQurzChessgroundConfig } from './ChessBoardSurface';

const HOME_POSITION = 518;

type Props = { playerName?: string };

/** Homepage preview using the exact shared gameplay Chessground renderer. */
export default function HomeBoardPreview({ playerName = 'You' }: Props) {
  const reducedMotion = useReducedMotion();
  const fen = chess960Fen(HOME_POSITION);
  const config = useMemo<QQurzChessgroundConfig>(() => ({
    fen,
    orientation: 'white',
    turnColor: 'white',
    coordinates: true,
    coordinatesOnSquares: true,
    viewOnly: true,
    highlight: { lastMove: false, check: true },
    animation: { enabled: !reducedMotion, duration: reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 160) },
  }), [fen, reducedMotion]);

  return (
    <section className="home-live-board-shell" aria-label="QQURZ Chess960 game board preview">
      <div className="home-live-board-title">
        <span>CHESS960 BOARD</span>
        <strong>960</strong>
      </div>
      <div className="home-preview-player top">
        <span><i className="preview-status-dot" />Opponent</span>
        <strong>10:00</strong>
      </div>
      <ChessBoardSurface
        config={config}
        instanceKey={`home-${HOME_POSITION}`}
        className="home-live-board"
        ariaLabel="Chess960 preview using the QQURZ gameplay board"
      />
      <div className="home-preview-player bottom">
        <span><i className="preview-status-dot active" />{playerName}</span>
        <strong>10:00</strong>
      </div>
    </section>
  );
}
