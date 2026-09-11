import { useEffect, useRef, useState } from 'react';
import type { Color } from '@lichess-org/chessground/types';
import ChessClock3DView from './ChessClock3DView';
import { clockVisible, setClockVisible, subscribeClockVisible } from './clockPreference';
import { playChessSound } from './sound';

export type PhysicalChessClockProps = {
  whiteSeconds: number;
  blackSeconds: number;
  activeColor?: Color | null;
  pendingSlap?: Color | null;
  disabled?: boolean;
  onSlap?: () => void;
  compact?: boolean;
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  showVisibilityToggle?: boolean;
  title?: string;
  className?: string;
};

type SlapEvent = { color: Color | null; nonce: number };

/**
 * The one React-facing physical clock used across QQURZ.
 *
 * The parent owns the authoritative game/clock state. This component never
 * changes turns or time itself. A physical slap (animation + recorded sound)
 * is emitted only after authoritative state confirms a pending clock press has
 * transferred control to the other side. That keeps timer, LED, rocker, sound
 * and game turn from drifting apart, including over realtime multiplayer.
 */
export default function PhysicalChessClock({
  whiteSeconds,
  blackSeconds,
  activeColor = null,
  pendingSlap = null,
  disabled = false,
  onSlap,
  compact = false,
  visible,
  onVisibleChange,
  showVisibilityToggle = true,
  title = 'TOURNAMENT CLOCK',
  className = '',
}: PhysicalChessClockProps) {
  const [storedVisible, setStoredVisible] = useState(clockVisible);
  const previousPending = useRef<Color | null>(pendingSlap);
  const [slapEvent, setSlapEvent] = useState<SlapEvent>({ color: null, nonce: 0 });
  const isVisible = visible ?? storedVisible;

  useEffect(() => subscribeClockVisible(setStoredVisible), []);

  useEffect(() => {
    const previous = previousPending.current;
    // A real transfer is pending side -> no pending side -> opposite active side.
    // Do not slap if the pending state disappeared because the game ended.
    if (previous && !pendingSlap && activeColor && activeColor !== previous) {
      playChessSound('slap');
      setSlapEvent(value => ({ color: previous, nonce: value.nonce + 1 }));
    }
    previousPending.current = pendingSlap;
  }, [activeColor, pendingSlap]);

  const changeVisibility = (next: boolean) => {
    if (onVisibleChange) onVisibleChange(next);
    else setClockVisible(next);
    setStoredVisible(next);
  };

  const status = pendingSlap
    ? `${pendingSlap.toUpperCase()} · press the rocker`
    : activeColor
      ? `${activeColor.toUpperCase()} clock running`
      : 'Ready';

  return (
    <section className={`qqurz-physical-clock-panel ${isVisible ? '' : 'clock-hidden'} ${className}`.trim()} aria-label="Physical chess clock">
      <div className="qqurz-clock-panel-head">
        <div>
          <b>{title}</b>
          <span>{status}</span>
        </div>
        {showVisibilityToggle && (
          <button type="button" className="clock-visibility-toggle" onClick={() => changeVisibility(!isVisible)}>
            {isVisible ? 'Hide clock' : 'Show clock'}
          </button>
        )}
      </div>
      {isVisible ? (
        <ChessClock3DView
          whiteSeconds={whiteSeconds}
          blackSeconds={blackSeconds}
          activeColor={activeColor}
          pendingSlap={pendingSlap}
          disabled={disabled}
          onSlap={onSlap}
          compact={compact}
          slapColor={slapEvent.color}
          slapNonce={slapEvent.nonce}
        />
      ) : (
        <div className="qqurz-clock-hidden-note">Clock hidden. Game timing continues normally.</div>
      )}
    </section>
  );
}
