import { handleMatchmakerRequest, Matchmaker, type MatchmakerEnv } from '../../matchmaker';
import { moduleDescriptor } from '../contracts';

export { Matchmaker };
export type MatchmakingModuleEnv = MatchmakerEnv;

export const matchmakingModule = moduleDescriptor('matchmaking', [
  'presence queues',
  'public opponent selection',
  'friend room creation and join coordination',
], ['auth', 'game']);

export async function handleMatchmakingRequest(request: Request, env: MatchmakingModuleEnv): Promise<Response | null> {
  return handleMatchmakerRequest(request, env);
}
