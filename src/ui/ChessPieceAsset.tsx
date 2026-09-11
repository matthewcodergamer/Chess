import { createElement } from 'react';

export type PieceAssetColor = 'white' | 'black';
export type PieceAssetRole = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

type Props = {
  color: PieceAssetColor;
  role: PieceAssetRole;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
};

/** Reuses Chessground's exact cburnett SVG selector instead of Unicode glyphs. */
export default function ChessPieceAsset({ color, role, size = 'md', label, className = '' }: Props) {
  return (
    <span
      className={`cg-wrap qqurz-piece-asset qqurz-piece-${size} ${className}`.trim()}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-piece-set="cburnett-svg"
    >
      {createElement('piece', { className: `${role} ${color}` })}
    </span>
  );
}
