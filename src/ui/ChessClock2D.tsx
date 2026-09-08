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
 * Kept under the old export name so existing game code does not need two clock
 * implementations. The normal chessboard is 2D; the physical clock is now the
 * SAME true 3D model used by Premium 3D, rendered front-facing below the board.
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
    const install = () => {
      if (stopped || dock) return true;
      const shell = document.querySelector('.local-fast-shell:not(.setup-only)');
      const frame = shell?.querySelector('.local-board-frame');
      if (!frame?.parentElement) return false;
      const existing = frame.parentElement.querySelector<HTMLDivElement>(':scope > .qqurz-clock-dock');
      owned = existing ?? document.createElement('div');
      if (!existing) {
        owned.className = 'qqurz-clock-dock';
        frame.insertAdjacentElement('afterend', owned);
      }
      setDock(owned);
      return true;
    };
    if (!install()) {
      const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = window.setTimeout(() => observer.disconnect(), 5000);
      return () => { stopped = true; window.clearTimeout(timer); observer.disconnect(); owned?.remove(); };
    }
    return () => { stopped = true; owned?.remove(); };
  }, [dock]);

  if (!dock) return null;
  return createPortal(
    <section className={`qqurz-physical-clock-panel ${visible ? '' : 'clock-hidden'}`} aria-label="Tournament clock">
      <div className="qqurz-clock-panel-head">
        <div><b>3D TOURNAMENT CLOCK</b><span>{pendingSlap ? `${pendingSlap.toUpperCase()} · press the white rocker` : activeColor ? `${activeColor.toUpperCase()} clock running` : 'Ready'}</span></div>
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
