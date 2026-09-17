import { OperationalDataRegistry as DataRegistry } from '../../data/operations';
import type { DataModelEnv } from '../../data/registry';
import { AccountRegistry, handleIdentityRequest, handlePlayerDiscoveryRequest, type AuthModuleEnv } from '../auth';
import { ChessRoom, handleAuthoritativeGameFallback, handleGameRequest, type GameModuleEnv } from '../game';
import { Matchmaker, handleMatchmakingRequest, type MatchmakingModuleEnv } from '../matchmaking';
import { TournamentRegistry, handleTournamentModuleRequest, type TournamentModuleEnv } from '../tournament';
import { PaymentLedger, handlePaymentsRequest, type PaymentsModuleEnv } from '../payments';
import { IntegrityReviewRegistry, guardCompetitiveRequest, handleModerationRequest, type ModerationModuleEnv } from '../moderation';
import { NotificationRegistry, handleNotificationsRequest, type NotificationsModuleEnv } from '../notifications';
import { handleAdminRequest, type AdminModuleEnv } from '../admin';
import { moduleDescriptor } from '../contracts';

export {
  AccountRegistry,
  ChessRoom,
  DataRegistry,
  IntegrityReviewRegistry,
  Matchmaker,
  NotificationRegistry,
  PaymentLedger,
  TournamentRegistry,
};

export type RealtimeGatewayEnv =
  & AuthModuleEnv
  & GameModuleEnv
  & MatchmakingModuleEnv
  & TournamentModuleEnv
  & PaymentsModuleEnv
  & ModerationModuleEnv
  & NotificationsModuleEnv
  & AdminModuleEnv
  & DataModelEnv
  & {
    ALLOWED_ORIGINS?: string;
    PAYMENTS_COMPLIANCE_WEBHOOK_SECRET?: string;
    DEPLOYMENT_ENV?: string;
    RELEASE_ID?: string;
  };

export const realtimeGatewayModule = moduleDescriptor('realtime-gateway', [
  'HTTP/WebSocket ingress composition',
  'CORS and transport-level policy',
  'deterministic module routing order',
  'Durable Object export composition',
  'environment and release health metadata',
], ['admin', 'moderation', 'notifications', 'auth', 'payments-ledger', 'matchmaking', 'tournament-engine', 'game']);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function withCors(request: Request, response: Response, env: RealtimeGatewayEnv): Response {
  const origin = request.headers.get('origin');
  const allowed = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  const headers = new Headers(response.headers);
  if (origin && allowed.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization,idempotency-key,x-integrity-admin');
  headers.set('access-control-max-age', '86400');
  if (env.RELEASE_ID) headers.set('x-qqurz-release', env.RELEASE_ID);
  if (env.DEPLOYMENT_ENV) headers.set('x-qqurz-environment', env.DEPLOYMENT_ENV);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function routed(request: Request, env: RealtimeGatewayEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && (url.pathname === '/_health' || url.pathname === '/healthz')) {
    return json({
      ok: true,
      service: 'qqurz-chess-api',
      environment: env.DEPLOYMENT_ENV ?? 'development',
      release: env.RELEASE_ID ?? 'unknown',
    });
  }

  const admin = await handleAdminRequest(request, env);
  if (admin) return admin;

  const moderation = await handleModerationRequest(request, env);
  if (moderation) return moderation;

  const notifications = await handleNotificationsRequest(request, env);
  if (notifications) return notifications;

  const social = await handlePlayerDiscoveryRequest(request, env);
  if (social) return social;

  const payments = await handlePaymentsRequest(request, env);
  if (payments) return payments;

  const identity = await handleIdentityRequest(request, env);
  if (identity) return identity;

  // Public matchmaking is intentionally available from the single Find-an-opponent flow.
  // Keep it ahead of the competitive fair-play gate so guests can queue and be matched.
  const matchmaking = await handleMatchmakingRequest(request, env);
  if (matchmaking) return matchmaking;

  const competitiveGate = await guardCompetitiveRequest(request, env);
  if (competitiveGate) return competitiveGate;

  const tournament = await handleTournamentModuleRequest(request, env);
  if (tournament) return tournament;

  const game = await handleGameRequest(request, env);
  if (game) return game;

  return handleAuthoritativeGameFallback(request, env);
}

const realtimeGateway = {
  async fetch(request: Request, env: RealtimeGatewayEnv): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }), env);
    return withCors(request, await routed(request, env), env);
  },
} satisfies ExportedHandler<RealtimeGatewayEnv>;

export default realtimeGateway;
