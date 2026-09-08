import baseHandler, { ChessRoom } from './index';
import { handleTournamentRequest, type TournamentEnv } from './tournaments';

export { ChessRoom };

type Env = TournamentEnv & {
  ROOMS: DurableObjectNamespace<ChessRoom>;
  ALLOWED_ORIGINS?: string;
};

function withCors(request: Request, response: Response, env: Env): Response {
  const origin = request.headers.get('origin');
  const allowed = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  const headers = new Headers(response.headers);
  if (origin && allowed.has(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('access-control-max-age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return baseHandler.fetch(request, env, ctx);
    const tournamentResponse = await handleTournamentRequest(request, env);
    if (tournamentResponse) return withCors(request, tournamentResponse, env);
    return baseHandler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
