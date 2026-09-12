import { lazy, Suspense } from 'react';
import type { QuarterFace } from './Quarter3D';

const Quarter3D = lazy(() => import('./Quarter3D'));

type Props = {
  result: QuarterFace | null;
  flippedAt?: number | null;
  className?: string;
};

/**
 * Keeps Three.js out of the OnlineArena static dependency closure. The fallback
 * reserves the coin's visual slot while the decorative renderer downloads;
 * room state, Chessground and move controls stay interactive independently.
 */
export default function LazyQuarter3D(props: Props) {
  return (
    <Suspense fallback={<div className="qqurz-quarter-wrap"><div className="qqurz-quarter-3d loading" aria-hidden="true" /></div>}>
      <Quarter3D {...props} />
    </Suspense>
  );
}
