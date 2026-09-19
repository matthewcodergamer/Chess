import { useMemo } from 'react';
import { chess960Fen } from '../game/chess960';
import { motionTokenMs, useReducedMotion } from './motion';
import ChessBoardSurface, { type QQurzChessgroundConfig } from './ChessBoardSurface';

const HOME_POSITION = 518;
const PREVIEW_NAMES = ['Maya', 'Leo', 'Asha', 'Kai', 'Nia', 'Omar', 'Priya', 'Theo', 'Lila', 'Noah', 'Imani', 'Jules'];

type Props = { playerName?: string };

function pickNames(): [string, string] {
  const first = PREVIEW_NAMES[Math.floor(Math.random() * PREVIEW_NAMES.length)] ?? 'Maya';
  const rest = PREVIEW_NAMES.filter(name => name !== first);
  const second = rest[Math.floor(Math.random() * rest.length)] ?? 'Leo';
  return [first, second];
}

/** Homepage preview using the exact shared gameplay Chessground renderer. */
export default function HomeBoardPreview(_props: Props = {}) {
  const reducedMotion = useReducedMotion();
  const fen = chess960Fen(HOME_POSITION);
  const names = useMemo(pickNames, []);
  const config = useMemo<QQurzChessgroundConfig>(() => ({
    fen,
    orientation: 'white',
    turnColor: 'white',
    coordinates: true,
    coordinatesOnSquares: true,
    viewOnly: true,
    highlight: { lastMove: false, check: true },
    animation: { enabled: !reducedMotion, duration: reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 260) },
  }), [fen, reducedMotion]);

  return (
    <section className="home-live-board-shell" aria-label="QQURZ Chess960 game board preview">
      <div className="home-live-board-title">
        <span>Chess960 board</span>
        <strong>960</strong>
      </div>
      <div className="home-preview-player top">
        <span><i className="preview-status-dot" />{names[0]}</span>
        <strong>10:00</strong>
      </div>
      <ChessBoardSurface
        config={config}
        instanceKey={`home-${HOME_POSITION}`}
        className="home-live-board"
        ariaLabel="Chess960 preview using the QQURZ gameplay board"
      />
      <div className="home-preview-player bottom">
        <span><i className="preview-status-dot active" />{names[1]}</span>
        <strong>10:00</strong>
      </div>
    </section>
  );
}
