import type { Color } from '@lichess-org/chessground/types';

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

/**
 * Legacy compatibility shim. QQURZ now uses the normal 2D player clocks
 * around the board; the former Three.js physical clock and slap interaction
 * are intentionally removed from the product surface.
 */
export default function PhysicalChessClock(_props: PhysicalChessClockProps) {
  return null;
}
