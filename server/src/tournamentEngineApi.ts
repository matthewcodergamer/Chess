import type { Chess960RatingClass } from '../../shared/timeControl';
import { handleAccountRequest, resolveAccountSession, type AccountEnv } from './accounts';
import type { EngineTournamentRegistry } from './tournamentEngineRegistry';
import { ENGINE_ID_PATTERN } from './tournamentEngineTypes';

export type TournamentEngineEnv = AccountEnv & {
  TOURNAMENTS?: DurableObjectNamespace<EngineTournamentRegistry>;
  ROOMS: DurableObjectNamespace<any>;
  PAYMENTS_MODE?: string;
  LIVE_TOURNAMENT_PAYMENTS?: string;
};

type AccountProfile = {
  id: string;
  displayName: string;
  emailVerifiedAt: number | null;
  chess960Ratings?: Partial<Record<Chess960RatingClass, { rating?: number }>>;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function forward(response: Response): Response {
  return new Response(response.body, { status: response.status, headers: response.headers });
}
function registryStub(env: TournamentEngineEnv): DurableObjectStub<EngineTournamentRegistry> | null {
  if (!env.TOURNAMENTS) return null;
  return env.TOURNAMENTS.get(env.TOURNAMENTS.idFromName('qqurz-master-tournament-registry'));
}
async function accountProfile(request: Request, env: AccountEnv): Promise<AccountProfile | null> {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const response = await handleAccountRequest(new Request('https://accounts.local/account/me', {
    headers: { authorization, 'user-agent': request.headers.get('user-agent') ?? '' },
  }), env);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({})) as { account?: AccountProfile };
  return payload.account ?? null;
}

export async function handleTournamentEngineRequest(request: Request, env: TournamentEngineEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/tournament-engine')) return null;
  const stub = registryStub(env);
  if (!stub) return json({ error: 'Tournament engine storage is not configured.' }, 503);

  if (request.method === 'GET' && url.pathname === '/tournament-engine/tournaments') {
    return forward(await stub.fetch(new Request('https://tournament.internal/engine/list')));
  }

  if (request.method === 'POST' && url.pathname === '/tournament-engine/tournaments') {
    const identity = await resolveAccountSession(request, env);
    if (!identity) return json({ error: 'Sign in to create a tournament.' }, 401);
    const definition = await request.json().catch(() => ({}));
    return forward(await stub.fetch(new Request('https://tournament.internal/engine/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizerAccountId: identity.id, organizerName: identity.displayName, definition }),
    })));
  }

  const match = /^\/tournament-engine\/tournaments\/([^/]+)(?:\/(register|check-in|start|advance|cancel|me))?$/.exec(url.pathname);
  if (!match) return json({ error: 'Not found.' }, 404);
  const id = decodeURIComponent(match[1]);
  if (!ENGINE_ID_PATTERN.test(id)) return json({ error: 'Invalid tournament id.' }, 400);
  const action = match[2] ?? '';

  if (request.method === 'GET' && !action) {
    return forward(await stub.fetch(new Request(`https://tournament.internal/engine/detail?id=${encodeURIComponent(id)}`)));
  }

  if (request.method === 'GET' && action === 'me') {
    const identity = await resolveAccountSession(request, env);
    if (!identity) return json({ error: 'Sign in to view your tournament assignment.' }, 401);
    return forward(await stub.fetch(new Request(`https://tournament.internal/engine/me?id=${encodeURIComponent(id)}&accountId=${encodeURIComponent(identity.id)}`)));
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const identity = await resolveAccountSession(request, env);
  if (!identity) return json({ error: 'Sign in required.' }, 401);

  if (action === 'register') {
    const profile = await accountProfile(request, env);
    if (!profile) return json({ error: 'Account profile is unavailable.' }, 401);
    const body = await request.json().catch(() => ({})) as { inviteCode?: string };
    return forward(await stub.fetch(new Request('https://tournament.internal/engine/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        accountId: profile.id,
        name: profile.displayName,
        emailVerifiedAt: profile.emailVerifiedAt,
        ratings: profile.chess960Ratings,
        inviteCode: body.inviteCode ?? '',
      }),
    })));
  }

  const internalAction = action === 'check-in' ? 'check-in' : action;
  return forward(await stub.fetch(new Request(`https://tournament.internal/engine/${internalAction}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, accountId: identity.id }),
  })));
}
