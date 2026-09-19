import { useMemo, useRef } from 'react';
import type { Color } from '@lichess-org/chessground/types';
import TimeControlPicker from '../ui/TimeControlPicker';
import LocalPromotionDialog from '../game/LocalPromotionDialog';
import { localBoardViewState } from '../game/boardViewState';
import {
  LOCAL_DIFFICULTIES,
  formatLocalClockMs,
  useLocalGameController,
  type LocalSideChoice,
} from '../game/useLocalGameController';
import ThreeBoardRenderer, { type ThreeBoardRendererHandle } from './ThreeBoardRenderer';
import { resultTextForViewer } from '../../shared/gameSession';
import { AppIcon } from '../ui/AppIcons';

type Props = { onBack: () => void };
function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }

export default function PremiumBoard3D({ onBack }: Props) {
  const game = useLocalGameController('human');
  const rendererRef = useRef<ThreeBoardRendererHandle | null>(null);
  const boardState = useMemo(
    () => localBoardViewState(game),
    [game.fen, game.legalDests, game.lastMove, game.movableColor, game.orientation, game.session.check, game.session.sideToMove],
  );

  if (game.phase === 'setup') {
    return <div data-performance-profile="premium-3d" className="premium-page-v14 qqurz-content-page three-play-page"><section className="page-heading-v14 compact"><button className="text-back" onClick={onBack}>← Home</button><span className="qqurz-kicker">PREMIUM 3D</span><h1>One game. Another view.</h1><p>Premium 3D uses the same QQURZ local game controller as the normal 2D board. Only the renderer changes.</p></section><section className="three-setup-card">
      <div className="local-mode-switch"><button className={game.mode === 'human' ? 'selected' : ''} onClick={() => game.setMode('human')}>Human vs Human</button><button className={game.mode === 'ai' ? 'selected' : ''} onClick={() => game.setMode('ai')}>Play AI</button></div>
      <TimeControlPicker value={game.timeControl} onChange={game.setTimeControl} />
      {game.mode === 'ai' && <div className="local-ai-options"><div><span>AI strength</span><div className="option-pills">{(Object.keys(LOCAL_DIFFICULTIES) as Array<keyof typeof LOCAL_DIFFICULTIES>).map(level => <button key={level} className={game.difficulty === level ? 'selected' : ''} onClick={() => game.setDifficulty(level)}><b>{LOCAL_DIFFICULTIES[level].label}</b><small>{LOCAL_DIFFICULTIES[level].note}</small></button>)}</div></div><div><span>Play as</span><div className="side-pills">{(['white','black','random'] as LocalSideChoice[]).map(side => <button key={side} className={game.sideChoice === side ? 'selected' : ''} onClick={() => game.setSideChoice(side)}>{side[0].toUpperCase() + side.slice(1)}</button>)}</div></div></div>}
      <div className="three-toolbar-row"><button className="primary-black" onClick={game.createPosition}>Create 3D position</button><span className="three-inline-note">Same rules, clocks and AI as 2D · Three.js loads only for this view</span></div>
    </section></div>;
  }

  return <div data-performance-profile="premium-3d" data-game-state={game.session.state} className="premium-page-v14 qqurz-content-page three-play-page">
    <section className="page-heading-v14 compact"><button className="text-back" onClick={onBack}>← Home</button><span className="qqurz-kicker">PREMIUM 3D</span><h1>Premium renderer. Shared chess core.</h1><p>The 2D and 3D boards consume the same renderer-facing state projection. Rules, clocks, results, AI, networking and tournament policy stay outside Three.js.</p></section>
    <section className="three-setup-card"><div className="three-toolbar-row"><button className="primary-black" onClick={game.createPosition}>New position</button><button className="secondary-clean" onClick={() => game.setOrientation(value => opposite(value))}>Flip board</button><button className="secondary-clean" onClick={() => rendererRef.current?.resetCamera()}>Reset camera</button><span className="three-inline-note">Drag to rotate · pinch/scroll to zoom · controller-supplied legal moves only</span></div></section>
    <section className="three-play-grid"><div className="three-main-column"><section className="three-board-card high-fidelity walnut">
      <ThreeBoardRenderer ref={rendererRef} state={boardState} onMove={game.boardMove} ariaLabel="Interactive Premium 3D Chess960 board" />
      <div className="three-preview-badge">PREMIUM 3D</div><div className="three-board-help">Tap piece, then destination</div>
      {game.phase === 'strategy' && <div className="local-board-overlay"><span>STRATEGY</span><strong>{formatLocalClockMs(game.session.countdownMs)}</strong><p>The legal destinations are computed by the shared chess controller, not by the renderer.</p><div><button onPointerDown={() => game.setFastForward(true)} onPointerUp={() => game.setFastForward(false)} onPointerCancel={() => game.setFastForward(false)}>Hold ×4</button><button className="primary-black" onClick={game.startNow}>Start Now</button></div></div>}
      {game.phase === 'ended' && game.session.result && <div className="local-board-overlay ended">{(resultTextForViewer(game.session, game.humanColor ?? game.orientation) ?? game.session.result) === 'You win' && <span className="match-trophy" aria-hidden="true"><AppIcon name="trophy" /></span>}<span>GAME OVER</span><strong className="end-title">{resultTextForViewer(game.session, game.humanColor ?? game.orientation) ?? game.session.result}</strong><button className="primary-black" onClick={game.createPosition}>New position</button></div>}
    </section></div>
      <aside className="three-side-column"><div className="three-panel"><span className="qqurz-kicker">POSITION {game.positionId !== null ? `#${game.positionId}` : '—'}</span><h2>{game.backRank || 'Open a 3D position'}</h2><p>{game.mode === 'ai' ? `You vs ${LOCAL_DIFFICULTIES[game.difficulty].label} Stockfish` : 'Two players on one device'} · {game.timeControl.label}</p></div>{game.mode === 'ai' && <div className={`local-engine-state ${game.engineStatus}`}>{game.engineStatus === 'loading' ? 'Loading Stockfish…' : game.engineStatus === 'thinking' ? 'Stockfish thinking…' : game.engineStatus === 'ready' ? 'Stockfish ready' : game.engineError || 'AI preparing'}</div>}<div className="three-panel muted"><span className="qqurz-kicker">RENDERER BOUNDARY</span><ul className="three-note-list"><li>2D and 3D consume the same shared board-state projection.</li><li>Piece meshes are instanced by role with per-instance color, reducing piece draw calls by half.</li><li>Board and table geometry render only surfaces visible from the play camera where practical.</li><li>Older iPhones cap device pixel ratio, reduce geometry detail and start without shadow maps.</li><li>Rendering is demand-driven and pauses when hidden, backgrounded or off-screen.</li></ul></div><div className="three-panel moves"><span className="qqurz-kicker">MOVES</span>{game.moves.length ? <ol>{game.moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}</div></aside>
    </section>
    <LocalPromotionDialog game={game} />
  </div>;
}
