import type { CSSProperties } from 'react';
import type { CoinFace } from '../multiplayer/types';

type Props = {
  result: CoinFace | null;
};

const REEDS = 119;

export default function QuarterCoin({ result }: Props) {
  const className = ['qqurz-quarter-v2', result ? 'flipping' : '', result ? `result-${result}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className="quarter-perspective" aria-label="Three-dimensional U.S. quarter coin">
      <div className={className}>
        <div className="quarter-rim" aria-hidden="true">
          {Array.from({ length: REEDS }, (_, index) => (
            <i
              key={index}
              className="quarter-reed"
              style={{ '--reed-angle': `${index * (360 / REEDS)}deg` } as CSSProperties}
            />
          ))}
        </div>

        <div className="quarter-face quarter-obverse">
          <span className="quarter-legend legend-top">LIBERTY</span>
          <span className="quarter-legend legend-left">IN GOD</span>
          <span className="quarter-legend legend-right">WE TRUST</span>
          <svg className="washington-relief" viewBox="0 0 120 120" aria-hidden="true">
            <path d="M77 19c-8 1-15 5-21 11-5 5-9 12-11 20-2 7-2 14 0 21 2 6 5 10 8 14-5 6-8 12-10 20h48c-2-7-5-13-11-18 6-4 11-10 13-17 3-10 1-20-5-28-2-4-5-7-8-9 3-5 4-9 3-14-2 1-4 1-6 0z" />
            <path d="M48 55c4-1 8-3 12-6 4-4 7-8 8-14 3 5 7 8 13 10l-3 7 6 5-7 4 1 8-9 1c-2 6-7 11-14 14-5-5-8-11-9-18l2-11z" />
            <path d="M43 104c11-8 21-11 31-11 9 0 17 3 25 11" fill="none" strokeWidth="5" strokeLinecap="round" />
          </svg>
          <span className="quarter-year">2026</span>
          <span className="quarter-mint">P</span>
        </div>

        <div className="quarter-face quarter-reverse">
          <span className="quarter-legend legend-top reverse-top">UNITED STATES OF AMERICA</span>
          <svg className="eagle-relief" viewBox="0 0 120 120" aria-hidden="true">
            <path d="M59 30c8 7 12 12 13 18 10-7 20-10 31-9-8 8-14 16-19 25 8-1 14 0 20 2-8 6-17 10-27 12-2 7-7 12-17 16-9-4-15-9-17-16-10-2-19-6-27-12 6-2 13-3 20-2-5-9-11-17-19-25 12-1 22 2 31 9 2-6 6-12 13-18z" />
            <path d="M47 91h27M42 98h37" fill="none" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <span className="quarter-e-pluribus">E PLURIBUS UNUM</span>
          <span className="quarter-value">QUARTER DOLLAR</span>
        </div>
      </div>
      <span className="quarter-spec" aria-hidden="true">24.26 mm · 1.75 mm · 119 reeds</span>
    </div>
  );
}
