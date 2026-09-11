import baseHandler from './index';
import { AccountRegistry, handleAccountRequest, type AccountEnv } from './accounts';
import { handleMatchmakerRequest, Matchmaker, type MatchmakerEnv } from './matchmaker';
import { handleTournamentRequest, type TournamentEnv } from './tournaments';
import { handleSpectatorRoomRequest, SpectatorChessRoom as ChessRoom, type SpectatorRoomEnv } from './spectatorRoom';
import { handleTournamentViewingRequest, ViewingTournamentRegistry as TournamentRegistry, type TournamentViewingEnv } from './tournamentViewing';

export { AccountRegistry, ChessRoom, Matchmaker, TournamentRegistry };

type Env = MatchmakerEnv & AccountEnv & SpectatorRoomEnv & TournamentViewingEnv & {
  ROOMS: DurableObjectNamespace<ChessRoom>;
  TOURNAMENTS?: DurableObjectNamespace<TournamentRegistry>;
  ALLOWED_ORIGINS?: string;
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
  headers.set('access-control-allow-headers', 'content-type,authorization');
  headers.set('access-control-max-age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(request, new Response(null, { status: 204 }), env);
    }

    const accountResponse = await handleAccountRequest(request, env);
    if (accountResponse) return withCors(request, accountResponse, env);

    const matchmakerResponse = await handleMatchmakerRequest(request, env);
    if (matchmakerResponse) return withCors(request, matchmakerResponse, env);

    const tournamentViewingResponse = await handleTournamentViewingRequest(request, env);
    if (tournamentViewingResponse) return withCors(request, tournamentViewingResponse, env);

    // Runtime TOURNAMENTS is the viewing-aware subclass. The existing catalog
    // handler only needs the Durable Object namespace fetch surface.
    const tournamentResponse = await handleTournamentRequest(request, env as unknown as TournamentEnv);
    if (tournamentResponse) return withCors(request, tournamentResponse, env);

    const spectatorRoomResponse = await handleSpectatorRoomRequest(request, env);
    if (spectatorRoomResponse) return withCors(request, spectatorRoomResponse, env);

    // Runtime ROOMS is the spectator-aware subclass of AuthoritativeChessRoom.
    // The base HTTP router only needs the Durable Object namespace fetch surface.
    return baseHandler.fetch(request, env as unknown as BaseHandlerEnv);
  },
} satisfies ExportedHandler<Env>;
