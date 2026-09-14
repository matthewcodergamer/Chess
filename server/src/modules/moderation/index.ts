import {
  handleFairPlayAdminRequest,
  handleFairPlayRequest,
  requireFairPlayForCompetitiveRequest,
} from '../../fairPlay';
import { handleFairPlayRoomActionRequest } from '../../fairPlayRoomApi';
import { handleIntegrityAdminRequest } from '../../integrityReview';
import { CanonicalIntegrityReviewRegistry as IntegrityReviewRegistry } from '../../data/moderationProjection';
import type { DataModelEnv } from '../../data/registry';
import { moduleDescriptor } from '../contracts';

type FairPlayEnv = Parameters<typeof handleFairPlayRequest>[1];
type RoomActionEnv = Parameters<typeof handleFairPlayRoomActionRequest>[1];
type AdminEnv = Parameters<typeof handleIntegrityAdminRequest>[1] & Parameters<typeof handleFairPlayAdminRequest>[1];

export { IntegrityReviewRegistry, handleFairPlayAdminRequest, handleIntegrityAdminRequest };
export type ModerationModuleEnv = FairPlayEnv & RoomActionEnv & AdminEnv & DataModelEnv;

export const moderationModule = moduleDescriptor('moderation', [
  'fair-play policy and acceptance',
  'player reports and competitive blocks',
  'integrity evidence and review cases',
  'moderation actions and funded-review gates',
], ['auth', 'game', 'payments-ledger']);

export async function handleModerationRequest(request: Request, env: ModerationModuleEnv): Promise<Response | null> {
  const fairPlay = await handleFairPlayRequest(request, env);
  if (fairPlay) return fairPlay;
  return handleFairPlayRoomActionRequest(request, env);
}

export async function guardCompetitiveRequest(request: Request, env: ModerationModuleEnv): Promise<Response | null> {
  return requireFairPlayForCompetitiveRequest(request, env);
}
