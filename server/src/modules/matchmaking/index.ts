import { handleMatchmakerRequest, type MatchmakerEnv } from '../../matchmaker';
import { OperationalMatchmaker as Matchmaker } from './opsMatchmaker';
import { moduleDescriptor } from '../contracts';

export { Matchmaker };
export type MatchmakingModuleEnv = MatchmakerEnv & { INTEGRITY_ADMIN_SECRET?: string };

export const matchmakingModule = moduleDescriptor('matchmaking', [
  'presence queues',
  'public opponent selection',
  'friend room creation and join coordination',
  'privileged operations presence snapshot',
], ['auth', 'game']);

export async function handleMatchmakingRequest(request: Request, env: MatchmakingModuleEnv): Promise<Response | null> {
  return handleMatchmakerRequest(request, env);
}
