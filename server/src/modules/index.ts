import { adminModule } from './admin';
import { authModule } from './auth';
import { gameModule } from './game';
import { matchmakingModule } from './matchmaking';
import { moderationModule } from './moderation';
import { notificationsModule } from './notifications';
import { paymentsModule } from './payments';
import { ratingModule } from './rating';
import { realtimeGatewayModule } from './realtime';
import { tournamentModule } from './tournament';
import { BACKEND_SERVICE_ORDER, type BackendModuleDescriptor } from './contracts';

export const backendModuleCatalog: readonly BackendModuleDescriptor[] = Object.freeze([
  adminModule,
  moderationModule,
  notificationsModule,
  authModule,
  paymentsModule,
  matchmakingModule,
  tournamentModule,
  gameModule,
  ratingModule,
  realtimeGatewayModule,
]);

const names = new Set(backendModuleCatalog.map(module => module.name));
for (const expected of BACKEND_SERVICE_ORDER) {
  if (!names.has(expected)) throw new Error(`Backend module catalog is missing ${expected}.`);
}

export { BACKEND_SERVICE_ORDER } from './contracts';
export type { BackendModuleDescriptor, BackendServiceName } from './contracts';
