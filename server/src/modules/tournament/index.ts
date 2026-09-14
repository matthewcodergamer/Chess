import { handleTournamentEngineRequest } from '../../tournamentEngineApi';
import { handleTournamentViewingRequest } from '../../tournamentViewing';
import { handleTournamentRequest } from '../../tournaments';
import { CanonicalTournamentRegistry as TournamentRegistry } from '../../data/tournamentProjection';
import type { DataModelEnv } from '../../data/registry';
import { moduleDescriptor } from '../contracts';

type EngineEnv = Parameters<typeof handleTournamentEngineRequest>[1];
type ViewingEnv = Parameters<typeof handleTournamentViewingRequest>[1];
type LegacyTournamentEnv = Parameters<typeof handleTournamentRequest>[1];

export { TournamentRegistry };
export type TournamentModuleEnv = EngineEnv & ViewingEnv & LegacyTournamentEnv & DataModelEnv;

export const tournamentModule = moduleDescriptor('tournament-engine', [
  'tournament definitions and registration',
  'check-in, seeding and pairings',
  'Swiss, round-robin and elimination lifecycle',
  'round state, standings and tournament viewing',
], ['auth', 'game', 'rating', 'payments-ledger', 'moderation', 'notifications']);

export async function handleTournamentModuleRequest(request: Request, env: TournamentModuleEnv): Promise<Response | null> {
  const engine = await handleTournamentEngineRequest(request, env);
  if (engine) return engine;
  const viewing = await handleTournamentViewingRequest(request, env);
  if (viewing) return viewing;
  return handleTournamentRequest(request, env);
}
