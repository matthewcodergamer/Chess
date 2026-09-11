import { useEffect, useState } from 'react';
import type { Color } from '@lichess-org/chessground/types';
import ChessClock3DView from './ChessClock3DView';
import { clockVisible, setClockVisible, subscribeClockVisible } from './clockPreference';

type Props = {
  whiteSeconds: number;
  blackSeconds: number;
  activeColor?: Color | null;
  pendingSlap?: Color | null;
  disabled?: boolean;
  onSlap?: () => void;
};

/**
 * Historical export name kept for compatibility. The board stays 2D while the
 * physical clock remains an optional, in-flow match accessory below the players.
 */
export default function ChessClock2D({
  whiteSeconds,
  blackSeconds,
  activeColor = null,
  pendingSlap = null,
  disabled = false,
  onSlap,
}: Props) {
  const [visible, setVisible] = useState(clockVisible);

  useEffect(() => subscribeClockVisible(setVisible), []);

  return (
    <section className={`qqurz-physical-clock-panel match-clock-panel ${visible ? '' : 'clock-hidden'}`} aria-label="Tournament clock">
      <div className="qqurz-clock-panel-head">
        <div>
          <b>TOURNAMENT CLOCK</b>
          <span>{pendingSlap ? `${pendingSlap.toUpperCase()} · press your rocker` : activeColor ? `${activeColor.toUpperCase()} clock running` : 'Ready'}</span>
        </div>
        <button type="button" className="clock-visibility-toggle" onClick={() => setClockVisible(!visible)}>{visible ? 'Hide clock' : 'Show clock'}</button>
      </div>
      {visible ? (
        <ChessClock3DView
          whiteSeconds={whiteSeconds}
          blackSeconds={blackSeconds}
          activeColor={activeColor}
          pendingSlap={pendingSlap}
          disabled={disabled}
          onSlap={onSlap}
        />
      ) : null}
    </section>
  );
}
