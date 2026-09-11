import { positiveCents } from '../../shared/money';
import { ratingClassForTimeControl, type Chess960RatingClass } from '../../shared/timeControl';
import { handleAccountRequest, resolveAccountSession, type AccountEnv } from './accounts';
import type { PaymentsEnv } from './paymentApi';

type RatingBook = Partial<Record<Chess960RatingClass, number>>;
type RoomStub = { fetch(request: Request): Promise<Response> };
type RoomNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): RoomStub };

type MoneyRoomEnv = PaymentsEnv & AccountEnv & { ROOMS: unknown };

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function roomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
}

function cleanName(value: unknown): string {
  const name = String(value ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 28);
  return name || 'Guest';
}

function stakeCents(value: unknown): number {
  const amount = positiveCents(value, 100_000);
  return amount >= 100 ? amount : 0;
}

function cleanTournamentId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return /^(?:knockout-\d+-\d+|event_[a-f0-9]{32})$/.test(id) ? id : null;
}

function rooms(env: MoneyRoomEnv): RoomNamespace {
  return env.ROOMS as RoomNamespace;
}

async function ratingBookForRequest(request: Request, env: AccountEnv): Promise<RatingBook> {
  const authorization = request.headers.get('authorization');
  if (!authorization) return {};
  const headers = new Headers({ authorization });
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('user-agent', userAgent);
  const accountRequest = new Request('https://accounts.local/account/me', { headers });
  const response = await handleAccountRequest(accountRequest, env);
  if (!response?.ok) return {};
  const payload = await response.json().catch(() => ({})) as {
    account?: { chess960Ratings?: Partial<Record<Chess960RatingClass, { rating?: number }>> };
  };
  const ratings = payload.account?.chess960Ratings;
  return {
    rapid: Number.isFinite(ratings?.rapid?.rating) ? Number(ratings?.rapid?.rating) : undefined,
    blitz: Number.isFinite(ratings?.blitz?.rating) ? Number(ratings?.blitz?.rating) : undefined,
    bullet: Number.isFinite(ratings?.bullet?.rating) ? Number(ratings?.bullet?.rating) : undefined,
  };
}

export async function handleMoneyRoomRequest(request: Request, env: MoneyRoomEnv): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === '/rooms' && request.method === 'POST') {
    const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
    const stake = stakeCents(body.stakeCents);
    if (!stake) return null;
    const identity = await resolveAccountSession(request, env);
    if (!identity) return json({ error: 'Sign in before creating a real-money match.' }, 401);
    const ratings = await ratingBookForRequest(request, env);
    const namespace = rooms(env);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = roomCode();
      const stub = namespace.get(namespace.idFromName(code));
      const internal = await stub.fetch(new Request('https://room.internal/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name: identity.displayName,
          accountId: identity.id,
          timeControl: body.timeControl,
          tournamentTemplateId: body.tournamentTemplateId,
          tournamentId: cleanTournamentId(body.tournamentId),
          ratings,
          stakeCents: stake,
        }),
      }));
      if (internal.status === 409) continue;
      return internal;
    }
    return json({ error: 'Could not allocate a staked room code. Try again.' }, 503);
  }

  const joinMatch = /^\/rooms\/([A-Z0-9]{6})\/join$/i.exec(url.pathname);
  if (joinMatch && request.method === 'POST') {
    const code = joinMatch[1].toUpperCase();
    const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
    const identity = await resolveAccountSession(request, env);
    const ratings = await ratingBookForRequest(request, env);
    const namespace = rooms(env);
    const stub = namespace.get(namespace.idFromName(code));
    return stub.fetch(new Request('https://room.internal/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: identity?.displayName ?? cleanName(body.name),
        accountId: identity?.id ?? null,
        ratings,
      }),
    }));
  }

  return null;
}

export function ratingForMoneyMatch(book: RatingBook, baseMs: number, incrementMs: number): number | null {
  const ratingClass = ratingClassForTimeControl(baseMs, incrementMs);
  const value = book[ratingClass];
  return Number.isFinite(value) ? Math.round(Number(value)) : null;
}
