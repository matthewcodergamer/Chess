import {
  handleFairPlayAdminRequest,
  handleIntegrityAdminRequest,
  type ModerationModuleEnv,
} from '../moderation';
import { moduleDescriptor } from '../contracts';
import { handleOperationsRequest, type OperationsModuleEnv } from './ops';

export type AdminModuleEnv = ModerationModuleEnv & OperationsModuleEnv;

export const adminModule = moduleDescriptor('admin', [
  'privileged operations health and business-state visibility',
  'active games, online players, tournaments, money and webhook monitoring',
  'moderation queues, disputed results and account actions',
  'operator-only integrity review actions',
  'append-only audit-log visibility',
], ['moderation', 'auth', 'matchmaking', 'game', 'tournament-engine', 'payments-ledger', 'notifications']);

export async function handleAdminRequest(request: Request, env: AdminModuleEnv): Promise<Response | null> {
  const operations = await handleOperationsRequest(request, env);
  if (operations) return operations;
  const fairPlay = await handleFairPlayAdminRequest(request, env);
  if (fairPlay) return fairPlay;
  return handleIntegrityAdminRequest(request, env);
}
