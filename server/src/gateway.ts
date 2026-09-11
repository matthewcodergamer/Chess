import baseHandler from './index';
import { AccountRegistry, handleAccountRequest, type AccountEnv } from './accounts';
import { handleMatchmakerRequest, Matchmaker, type MatchmakerEnv } from './matchmaker';
import { handleTournamentRequest, type TournamentEnv } from './tournaments';
import { handleSpectatorRoomRequest, type SpectatorRoomEnv } from './spectatorRoom';
import { handleTournamentViewingRequest, type TournamentViewingEnv } from './tournamentViewing';
import { handleTournamentEngineRequest, type TournamentEngineEnv } from './tournamentEngineApi';
import { EngineTournamentRegistry as TournamentRegistry } from './tournamentEngineRegistry';
import { CoinGateChessRoom as ChessRoom } from './coinGateRoom';
import { PaymentLedger } from './paymentLedger';
import { handlePaymentRequest, type PaymentsEnv } from './paymentApi';
import { handlePaymentComplianceWebhook } from './paymentCompliance';

export { AccountRegistry, ChessRoom, Matchmaker, PaymentLedger, TournamentRegistry };

type Env = MatchmakerEnv & AccountEnv & SpectatorRoomEnv & TournamentViewingEnv & TournamentEngineEnv & PaymentsEnv & {
  ROOMS: DurableObjectNamespace<ChessRoom>;
  TOURNAMENTS?: DurableObjectNamespace<TournamentRegistry>;
  PAYMENTS: DurableObjectNamespace<PaymentLedger>;
  ALLOWED_ORIGINS?: string;
  PAYMENTS_COMPLIANCE_WEBHOOK_SECRET?: string;
};

type BaseHandlerEnv = Parameters<typeof baseHandler.fetch>[1];

function withCors(request: Request, response: Response, env: Env): Response {
  const origin = request.headers.get('origin');
  const allowed = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  const headers = new Headers(response.headers);
  if (origin && allowed.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization,idempotency-key');
  headers.set('access-control-max-age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }), env);

    const complianceResponse = await handlePaymentComplianceWebhook(request, env);
    if (complianceResponse) return withCors(request, complianceResponse, env);

    const paymentResponse = await handlePaymentRequest(request, env);
    if (paymentResponse) return withCors(request, paymentResponse, env);

    const accountResponse = await handleAccountRequest(request, env);
    if (accountResponse) return withCors(request, accountResponse, env);

    const matchmakerResponse = await handleMatchmakerRequest(request, env);
    if (matchmakerResponse) return withCors(request, matchmakerResponse, env);

    const engineResponse = await handleTournamentEngineRequest(request, env);
    if (engineResponse) return withCors(request, engineResponse, env);

    const tournamentViewingResponse = await handleTournamentViewingRequest(request, env);
    if (tournamentViewingResponse) return withCors(request, tournamentViewingResponse, env);

    const tournamentResponse = await handleTournamentRequest(request, env as unknown as TournamentEnv);
    if (tournamentResponse) return withCors(request, tournamentResponse, env);

    const spectatorRoomResponse = await handleSpectatorRoomRequest(request, env);
    if (spectatorRoomResponse) return withCors(request, spectatorRoomResponse, env);

    return baseHandler.fetch(request, env as unknown as BaseHandlerEnv);
  },
} satisfies ExportedHandler<Env>;
