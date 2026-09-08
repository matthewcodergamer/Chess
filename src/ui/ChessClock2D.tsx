import type { Color } from '@lichess-org/chessground/types';

type Props = {
  whiteSeconds: number;
  blackSeconds: number;
  activeColor?: Color | null;
  pendingSlap?: Color | null;
  disabled?: boolean;
  onSlap?: () => void;
};

function fmt(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ChessClock2D({
  whiteSeconds,
  blackSeconds,
  activeColor = null,
  pendingSlap = null,
  disabled = false,
  onSlap,
}: Props) {
  const canSlap = Boolean(pendingSlap && onSlap && !disabled);
  const press = () => {
    if (canSlap) onSlap?.();
  };

  return (
    <div
      className={`qqurz-clock-2d ${pendingSlap ? `pending-${pendingSlap}` : ''}`}
      aria-label="QQURZ top-down digital chess clock"
    >
      <div className="qqurz-clock-lcd" aria-live="off">
        <div className={`lcd-half ${activeColor === 'white' ? 'active' : ''}`}>
          <strong>{fmt(whiteSeconds)}</strong><small>000</small>
        </div>
        <div className="lcd-center"><b>03</b><span>bonus ●</span></div>
        <div className={`lcd-half ${activeColor === 'black' ? 'active' : ''}`}>
          <strong>{fmt(blackSeconds)}</strong><small>000</small>
        </div>
      </div>

      <div className="qqurz-clock-controls" aria-hidden="true">
        <span>▲</span><span>↻</span><span>▶Ⅱ</span><span>▼</span>
      </div>

      <div className="qqurz-clock-rocker-well">
        <button
          type="button"
          className={`qqurz-clock-rocker ${pendingSlap ? 'armed' : ''}`}
          onPointerDown={(event) => { if (canSlap) { event.preventDefault(); press(); } }}
          onKeyDown={(event) => {
            if (!canSlap || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            press();
          }}
          disabled={!canSlap}
          aria-label={pendingSlap ? `Slap ${pendingSlap} clock` : 'Chess clock rocker'}
        >
          <span className="rocker-left" />
          <span className="rocker-groove" />
          <span className="rocker-right" />
        </button>
      </div>

      <div className="qqurz-clock-brand">QQURZ</div>
      <div className="qqurz-clock-prompt" aria-live="polite">
        {pendingSlap
          ? disabled
            ? `${pendingSlap.toUpperCase()} clock auto-pressing…`
            : `Tap the white slap bar · ${pendingSlap.toUpperCase()} moved`
          : 'LIVE CLOCK'}
      </div>
    </div>
  );
}
