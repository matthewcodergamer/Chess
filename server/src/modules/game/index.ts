import baseGameHandler from '../../index';
import { handleMoneyRoomRequest } from '../../moneyRoomApi';
import { handleSpectatorRoomRequest } from '../../spectatorRoom';
import { CanonicalChessRoom as ChessRoom } from '../../data/gameProjection';
import type { DataModelEnv } from '../../data/registry';
import { moduleDescriptor } from '../contracts';

type BaseGameEnv = Parameters<typeof baseGameHandler.fetch>[1];
type MoneyRoomEnv = Parameters<typeof handleMoneyRoomRequest>[1];
type SpectatorEnv = Parameters<typeof handleSpectatorRoomRequest>[1];

export { ChessRoom };
export type GameModuleEnv = BaseGameEnv & MoneyRoomEnv & SpectatorEnv & DataModelEnv;

export const gameModule = moduleDescriptor('game', [
  'authoritative Chess960 room state',
  'legal move validation and clocks',
  'game lifecycle and results',
  'spectator read models',
  'funded room coordination',
], ['auth', 'rating', 'payments-ledger', 'moderation', 'notifications']);

export async function handleGameRequest(request: Request, env: GameModuleEnv): Promise<Response | null> {
  const money = await handleMoneyRoomRequest(request, env);
  if (money) return money;
  return handleSpectatorRoomRequest(request, env);
}

export function handleAuthoritativeGameFallback(request: Request, env: GameModuleEnv): Promise<Response> {
  return baseGameHandler.fetch(request, env);
}
