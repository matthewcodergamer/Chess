import {
  handleFairPlayAdminRequest,
  handleIntegrityAdminRequest,
  type ModerationModuleEnv,
} from '../moderation';
import { moduleDescriptor } from '../contracts';

export type AdminModuleEnv = ModerationModuleEnv;

export const adminModule = moduleDescriptor('admin', [
  'privileged moderation queues and decisions',
  'operator-only integrity review actions',
  'future operational/admin APIs behind explicit authorization',
], ['moderation', 'auth']);

export async function handleAdminRequest(request: Request, env: AdminModuleEnv): Promise<Response | null> {
  const fairPlay = await handleFairPlayAdminRequest(request, env);
  if (fairPlay) return fairPlay;
  return handleIntegrityAdminRequest(request, env);
}
