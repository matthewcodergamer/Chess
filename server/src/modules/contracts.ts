export type BackendServiceName =
  | 'auth'
  | 'game'
  | 'realtime-gateway'
  | 'matchmaking'
  | 'tournament-engine'
  | 'rating'
  | 'payments-ledger'
  | 'moderation'
  | 'notifications'
  | 'admin';

export type ModuleRouteHandler<Env> = (request: Request, env: Env) => Promise<Response | null>;

export type BackendModuleDescriptor = Readonly<{
  name: BackendServiceName;
  deployment: 'modular-monolith';
  owns: readonly string[];
  dependsOn: readonly BackendServiceName[];
}>;

export const BACKEND_SERVICE_ORDER: readonly BackendServiceName[] = [
  'admin',
  'moderation',
  'notifications',
  'auth',
  'payments-ledger',
  'matchmaking',
  'tournament-engine',
  'game',
  'rating',
  'realtime-gateway',
] as const;

export function moduleDescriptor(
  name: BackendServiceName,
  owns: readonly string[],
  dependsOn: readonly BackendServiceName[] = [],
): BackendModuleDescriptor {
  return Object.freeze({ name, deployment: 'modular-monolith', owns: Object.freeze([...owns]), dependsOn: Object.freeze([...dependsOn]) });
}
