import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';
import { chess960Fen } from '../game/chess960';
import { motionTokenMs, useReducedMotion } from './motion';

const HOME_POSITION = 518;

/**
 * Homepage preview built with the exact same Chessground renderer and cburnett
 * piece set used by the playable board. This is intentionally not a decorative
 * CSS/mock chessboard.
 */
export default function HomeBoardPreview() {
  const node = useRef<HTMLDivElement | null>(null);
  const ground = useRef<ChessgroundApi | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!node.current) return;
    ground.current = Chessground(node.current, {
      fen: chess960Fen(HOME_POSITION),
      orientation: 'white',
      turnColor: 'white',
      coordinates: true,
      coordinatesOnSquares: true,
      viewOnly: true,
      highlight: { lastMove: false, check: true },
      animation: { enabled: !reducedMotion, duration: reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 160) },
    });
    return () => {
      ground.current?.destroy();
      ground.current = null;
    };
  }, [reducedMotion]);

  return (
    <section className="home-live-board-shell" aria-label="QQURZ Chess960 game board preview">
      <div className="home-live-board-title">
        <span>QQURZ BOARD</span>
        <strong>960</strong>
      </div>
      <div className="home-preview-player top">
        <span><i className="preview-status-dot" />Tournament table</span>
        <strong>10:00</strong>
      </div>
      <div ref={node} className="cg-wrap board-mount home-live-board" />
      <div className="home-preview-player bottom">
        <span><i className="preview-status-dot active" />Your move</span>
        <strong>10:00</strong>
      </div>
    </section>
  );
}
