import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * clock is the shared lightweight 3D physical model used across QQURZ.
 */
export default function ChessClock2D({
  whiteSeconds,
  blackSeconds,
  activeColor = null,
  pendingSlap = null,
  disabled = false,
  onSlap,
}: Props) {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(clockVisible);

  useEffect(() => subscribeClockVisible(setVisible), []);

  useEffect(() => {
    let owned: HTMLDivElement | null = null;
    let stopped = false;
    let observer: MutationObserver | null = null;
    let timer = 0;

    const install = () => {
      if (stopped) return true;
      const shell = document.querySelector('.local-fast-shell:not(.setup-only)');
      const frame = shell?.querySelector('.local-board-frame');
      if (!frame?.parentElement) return false;
      const parent = frame.parentElement;
      const existing = parent.querySelector<HTMLDivElement>(':scope > .qqurz-clock-dock');
      owned = existing ?? document.createElement('div');
      if (!existing) {
        owned.className = 'qqurz-clock-dock';
        // Keep the Lichess-style captured material directly against the board;
        // the physical clock sits immediately below that strip.
        const captured = parent.querySelector(':scope > .captured-strip');
        (captured ?? frame).insertAdjacentElement('afterend', owned);
      }
      setDock(owned);
      return true;
    };

    if (!install()) {
      observer = new MutationObserver(() => {
        if (install()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = window.setTimeout(() => observer?.disconnect(), 5000);
    }

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      observer?.disconnect();
      owned?.remove();
    };
  }, []);

  if (!dock) return null;
  return createPortal(
    <section className={`qqurz-physical-clock-panel ${visible ? '' : 'clock-hidden'}`} aria-label="Tournament clock">
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
      ) : (
        <div className="qqurz-clock-hidden-note">Clock hidden. Game timing continues normally.</div>
      )}
    </section>,
    dock,
  );
}
