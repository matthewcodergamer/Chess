import { handleAccountRequest, resolveAccountSession, type AccountEnv } from '../../accounts';
import { handleSocialRequest } from '../../social';
import { CanonicalAccountRegistry as AccountRegistry } from '../../data/accountProjection';
import type { DataModelEnv } from '../../data/registry';
import { moduleDescriptor } from '../contracts';

export { AccountRegistry, resolveAccountSession };
export type AuthModuleEnv = AccountEnv & DataModelEnv;

export const authModule = moduleDescriptor('auth', [
  'users and profiles',
  'auth identities and credentials',
  'sessions and device identity',
  'account privacy and social graph',
]);

export async function handlePlayerDiscoveryRequest(request: Request, env: AuthModuleEnv): Promise<Response | null> {
  return handleSocialRequest(request, env);
}

export async function handleIdentityRequest(request: Request, env: AuthModuleEnv): Promise<Response | null> {
  return handleAccountRequest(request, env);
}

export async function handleAuthRequest(request: Request, env: AuthModuleEnv): Promise<Response | null> {
  return (await handlePlayerDiscoveryRequest(request, env)) ?? handleIdentityRequest(request, env);
}
