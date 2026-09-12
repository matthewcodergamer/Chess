import ChessPieceAsset from '../ui/ChessPieceAsset';
import type { LocalGameController, LocalPromotionRole } from './useLocalGameController';

export default function LocalPromotionDialog({ game }: { game: LocalGameController }) {
  if (!game.promotion) return null;
  const roles: LocalPromotionRole[] = ['queen', 'rook', 'bishop', 'knight'];
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece"><div className="promotion-modal"><span className="qqurz-kicker">PROMOTION</span><h2>Choose a piece</h2><div className="promotion-grid">{roles.map(role => <button key={role} onClick={() => game.promote(role)}><ChessPieceAsset role={role} color={game.turn} size="lg" /><span>{role[0].toUpperCase() + role.slice(1)}</span></button>)}</div></div></div>;
}
