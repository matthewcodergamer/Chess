import type { QuarterFace } from './Quarter3D';

type Props = {
  result: QuarterFace | null;
  flippedAt?: number | null;
  className?: string;
};

/**
 * Compatibility wrapper retained for existing imports. The multiplayer game
 * screen no longer loads Three.js or renders a 3D object; the shared quarter
 * visual is intentionally a lightweight 2D element.
 */
export default function LazyQuarter3D({ result, className = '' }: Props) {
  return (
    <div className={`qqurz-quarter-wrap qqurz-quarter-2d ${className}`.trim()} aria-label={result ? `Quarter: ${result}` : 'Quarter toss'}>
      <div className="qqurz-quarter-face" aria-hidden="true">{result ? result.toUpperCase() : '●'}</div>
    </div>
  );
}
