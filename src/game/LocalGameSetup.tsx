import TimeControlPicker from '../ui/TimeControlPicker';
import { LOCAL_DIFFICULTIES, type LocalGameController, type LocalSideChoice } from './useLocalGameController';
import { allowedTimePresetIds, hasBlitzAccess, hasFreestyle } from '../premium/entitlements';

export default function LocalGameSetup({ game }: { game: LocalGameController }) {
  const clocksUnlocked = game.mode === 'ai' || hasBlitzAccess();
  return (
    <section className="local-fast-shell setup-only">
      <div className="local-fast-setup">
        <span className="qqurz-kicker">LOCAL PLAY</span>
        <h1>{game.mode === 'ai' ? 'Play Stockfish.' : 'Play together.'}</h1>
        <p>Choose your game. Then the board takes over — no dashboard, no clutter.</p>
        <div className="local-mode-switch" role="radiogroup" aria-label="Game mode">
          <button className={game.mode === 'human' ? 'selected' : ''} onClick={() => game.setMode('human')}>Human vs Human</button>
          <button className={game.mode === 'ai' ? 'selected' : ''} onClick={() => game.setMode('ai')}>Play AI</button>
        </div>
        <TimeControlPicker
          value={game.timeControl}
          onChange={game.setTimeControl}
          allowedPresetIds={clocksUnlocked ? ['3+2', '5+0', '10+5'] : allowedTimePresetIds()}
          allowCustom={clocksUnlocked}
        />
        <div className="game-setup-options">
          <div>
            <span>Play as</span>
            <div className="side-pills">{(['white', 'black', 'random'] as LocalSideChoice[]).map(side => <button key={side} className={game.sideChoice === side ? 'selected' : ''} onClick={() => game.setSideChoice(side)}>{side[0].toUpperCase() + side.slice(1)}</button>)}</div>
          </div>
          <div>
            <span>Take-backs</span>
            <div className="side-pills">
              <button className={game.takebacksOn ? 'selected' : ''} onClick={() => game.setTakebacksOn(true)}>On</button>
              <button className={!game.takebacksOn ? 'selected' : ''} onClick={() => game.setTakebacksOn(false)}>Off</button>
            </div>
          </div>
        </div>
        {game.mode === 'ai' && <div className="local-ai-options">
          <div><span>AI strength</span><div className="option-pills">{(Object.keys(LOCAL_DIFFICULTIES) as Array<keyof typeof LOCAL_DIFFICULTIES>).map(level => <button key={level} className={game.difficulty === level ? 'selected' : ''} onClick={() => game.setDifficulty(level)}><b>{LOCAL_DIFFICULTIES[level].label}</b><small>{LOCAL_DIFFICULTIES[level].note}</small></button>)}</div></div>
        </div>}
        {!clocksUnlocked && game.mode === 'human' && !hasFreestyle() && <p className="setup-lock-note">Blitz and bullet clocks are a Freestyle extra, or a $1.99 blitz pass.</p>}
        <button className="primary-black local-start" onClick={game.createPosition}>New Game</button>
      </div>
    </section>
  );
}
