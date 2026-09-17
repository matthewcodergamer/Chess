import type { ReactNode } from 'react';
import type { Color } from '@lichess-org/chessground/types';
import MatchPlayerBar from '../ui/MatchPlayerBar';
import StateNotice from '../ui/StateNotice';
import { LOCAL_DIFFICULTIES, formatLocalClockMs, type LocalGameController } from './useLocalGameController';

function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }

type Props = {
  game: LocalGameController;
  board: ReactNode;
  optionsOpen: boolean;
  onToggleOptions: () => void;
};

export default function LocalMatchChrome({ game, board, optionsOpen, onToggleOptions }: Props) {
  const topColor = opposite(game.orientation);
  const bottomColor = game.orientation;
  const clockFor = (color: Color) => formatLocalClockMs(color === 'white' ? game.whiteClockMs : game.blackClockMs);
  const engineFailed = game.mode === 'ai' && game.engineStatus === 'error';


  return <section className="local-fast-shell local-chess-layout" data-game-state={game.session.state}><div className="match-board-stack">
    <div className="match-game-meta"><b>Chess960 · #{game.positionId}</b><span>{game.mode === 'ai' ? `You vs ${LOCAL_DIFFICULTIES[game.difficulty].label} Stockfish` : 'Same-device game'} · {game.timeControl.label}</span></div>
    {game.mode === 'ai' && !engineFailed && <div className={`local-engine-state match-engine-state ${game.engineStatus}`}>{game.engineStatus === 'loading' ? 'Loading Stockfish…' : game.engineStatus === 'thinking' ? 'Stockfish thinking…' : game.engineStatus === 'ready' ? 'Stockfish ready' : 'AI preparing'}</div>}
    {engineFailed && <StateNotice
      className="compact"
      tone="warning"
      icon="♞"
      eyebrow="LOCAL AI"
      title="Stockfish isn’t available right now"
      body={<p>The chess board and rules are fine; only the optional AI engine failed to start. You can retry the engine or keep this position and play it as a same-device human game.</p>}
      detail="Retrying reloads the local game so the Stockfish bundle can initialize from a clean state."
      actions={[
        { label: 'Retry Stockfish', onClick: () => window.location.reload(), primary: true },
        { label: 'Play local human', onClick: () => game.setMode('human') },
      ]}
    />}
    <MatchPlayerBar color={topColor} name={game.playerName(topColor)} rating={game.ratingFor(topColor)} connection={game.connectionFor(topColor)} connected={game.mode !== 'ai' || game.aiColor !== topColor || game.engineStatus !== 'error'} time={clockFor(topColor)} fen={game.fen} active={game.activeColor === topColor} />
    <div className="local-board-frame match-board-frame">{board}
      {game.phase === 'strategy' && <div className="local-board-overlay"><span>STRATEGY</span><strong>{formatLocalClockMs(game.session.countdownMs)}</strong><p>Green dots show legal destinations. Take your time, then start when you are ready.</p><div><button onPointerDown={() => game.setFastForward(true)} onPointerUp={() => game.setFastForward(false)} onPointerCancel={() => game.setFastForward(false)}>Hold ×4</button><button className="primary-black" onClick={game.startNow}>Start game</button></div></div>}
      {game.phase === 'ended' && game.session.result && <div className="local-board-overlay ended"><span>GAME OVER</span><strong className="end-title">{game.session.result}</strong><button className="primary-black" onClick={game.createPosition}>New position</button></div>}
    </div>
    <MatchPlayerBar color={bottomColor} name={game.playerName(bottomColor)} rating={game.ratingFor(bottomColor)} connection={game.connectionFor(bottomColor)} connected={game.mode !== 'ai' || game.aiColor !== bottomColor || game.engineStatus !== 'error'} time={clockFor(bottomColor)} fen={game.fen} active={game.activeColor === bottomColor} self />
    <div className="match-controls" aria-label="Game controls"><div className={`match-turn-note ${game.activeColor === bottomColor ? 'active' : ''}`}>{game.phase === 'strategy' ? 'Strategy phase' : game.phase === 'ended' ? game.session.result : game.activeColor === bottomColor ? 'Your move' : 'Opponent move'}</div><button onClick={() => game.agreeDraw(bottomColor)} disabled={game.session.state !== 'ACTIVE'}>Draw</button><button className="match-resign" onClick={() => game.resign(bottomColor)} disabled={game.session.state !== 'ACTIVE'}>Resign</button><button aria-expanded={optionsOpen} onClick={onToggleOptions}>Options</button></div>
    {optionsOpen && <section className="match-options-panel" aria-label="Match options"><div><span>State</span><b>{game.session.state}</b></div><div><span>Position</span><b>Chess960 #{game.positionId}</b></div><div><span>Back rank</span><b>{game.backRank}</b></div><div><span>Move number</span><b>{game.session.moveNumber}</b></div><div><span>Increment</span><b>{game.session.clocks.incrementMs / 1000}s</b></div><div className="match-options-actions"><button onClick={() => game.setOrientation(value => opposite(value))}>Flip board</button><button onClick={game.createPosition} disabled={game.session.state === 'ACTIVE'}>{game.session.state === 'ACTIVE' ? 'Position locked' : 'New position'}</button></div><div className="match-move-list"><span className="qqurz-kicker">MOVES</span>{game.moves.length ? <ol>{game.moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet. Make the first move when you are ready.</p>}</div></section>}
  </div></section>;
}
