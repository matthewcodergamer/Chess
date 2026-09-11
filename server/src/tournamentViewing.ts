import { TournamentRegistry as BaseTournamentRegistry } from './tournaments';
import type { AccountEnv } from './accounts';

export type TournamentViewingEnv = AccountEnv & {
  TOURNAMENTS?: DurableObjectNamespace<ViewingTournamentRegistry>;
};

type Color = 'white' | 'black';
type InternalPlayer = {
  name: string;
  rating: number | null;
  accountId: string | null;
};

type StoredTournamentGame = {
  tournamentId: string;
  roomCode: string;
  round: number;
  white: InternalPlayer;
  black: InternalPlayer;
  startedAt: number;
  updatedAt: number;
  status: 'live' | 'complete';
  result: string | null;
  winner: Color | null;
};

type GameStore = Record<string, StoredTournamentGame[]>;

export type TournamentGameRecord = {
  tournamentId: string;
  roomCode: string;
  round?: number;
  white: InternalPlayer;
  black: InternalPlayer;
  startedAt?: number;
  result?: string | null;
  winner?: Color | null;
  complete?: boolean;
};

export type TournamentStanding = {
  rank: number;
  name: string;
  rating: number | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  status: 'playing' | 'active' | 'eliminated';
};

const STORE_KEY = 'tournament-view-games:v1';
const TOURNAMENT_ID = /^(?:knockout-\d+-\d+|event_[a-f0-9]{32})$/;
const ROOM_CODE = /^[A-Z0-9]{6}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function cleanName(value: unknown): string {
  const name = String(value ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return name || 'Guest';
}

function cleanRating(value: unknown): number | null {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 100 && rating <= 5000 ? Math.round(rating) : null;
}

function cleanPlayer(value: unknown): InternalPlayer | null {
  if (!value || typeof value !== 'object') return null;
  const player = value as Record<string, unknown>;
  return {
    name: cleanName(player.name),
    rating: cleanRating(player.rating),
    accountId: typeof player.accountId === 'string' && player.accountId ? player.accountId.slice(0, 120) : null,
  };
}

function playerKey(player: InternalPlayer): string {
  return player.accountId ? `account:${player.accountId}` : `name:${player.name.trim().toLowerCase()}`;
}

function publicGame(game: StoredTournamentGame) {
  return {
    tournamentId: game.tournamentId,
    roomCode: game.roomCode,
    round: game.round,
    white: { name: game.white.name, rating: game.white.rating },
    black: { name: game.black.name, rating: game.black.rating },
    startedAt: game.startedAt,
    updatedAt: game.updatedAt,
    status: game.status,
    result: game.result,
    winner: game.winner,
  };
}

function standingsFor(games: StoredTournamentGame[]): TournamentStanding[] {
  type MutableStanding = Omit<TournamentStanding, 'rank' | 'status'> & { playing: boolean };
  const table = new Map<string, MutableStanding>();
  const ensure = (player: InternalPlayer): MutableStanding => {
    const key = playerKey(player);
    const existing = table.get(key);
    if (existing) {
      if (existing.rating === null && player.rating !== null) existing.rating = player.rating;
      return existing;
    }
    const standing: MutableStanding = {
      name: player.name,
      rating: player.rating,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      score: 0,
      playing: false,
    };
    table.set(key, standing);
    return standing;
  };

  for (const game of games) {
    const white = ensure(game.white);
    const black = ensure(game.black);
    if (game.status === 'live') {
      white.playing = true;
      black.playing = true;
      continue;
    }
    white.games += 1;
    black.games += 1;
    if (game.winner === 'white') {
      white.wins += 1; white.score += 1; black.losses += 1;
    } else if (game.winner === 'black') {
      black.wins += 1; black.score += 1; white.losses += 1;
    } else {
      white.draws += 1; black.draws += 1; white.score += .5; black.score += .5;
    }
  }

  return [...table.values()]
    .sort((a, b) => b.score - a.score || b.wins - a.wins || a.losses - b.losses || (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name))
    .map((entry, index) => ({
      rank: index + 1,
      name: entry.name,
      rating: entry.rating,
      games: entry.games,
      wins: entry.wins,
      draws: entry.draws,
      losses: entry.losses,
      score: entry.score,
      status: entry.playing ? 'playing' : entry.losses > 0 ? 'eliminated' : 'active',
    }));
}

function registryStub(env: TournamentViewingEnv): DurableObjectStub<ViewingTournamentRegistry> | null {
  if (!env.TOURNAMENTS) return null;
  return env.TOURNAMENTS.get(env.TOURNAMENTS.idFromName('qqurz-master-tournament-registry'));
}

export async function recordTournamentGame(env: TournamentViewingEnv, record: TournamentGameRecord): Promise<void> {
  const stub = registryStub(env);
  if (!stub) return;
  try {
    await stub.fetch(new Request('https://tournament.internal/view-game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    }));
  } catch {
    // Tournament viewing is supplemental. Never block authoritative gameplay.
  }
}

export async function handleTournamentViewingRequest(request: Request, env: TournamentViewingEnv): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const match = /^\/tournaments\/([^/]+)\/live$/.exec(url.pathname);
  if (!match) return null;
  const tournamentId = decodeURIComponent(match[1]);
  if (!TOURNAMENT_ID.test(tournamentId)) return json({ error: 'Invalid tournament id.' }, 400);
  const stub = registryStub(env);
  if (!stub) return json({ tournamentId, games: [], standings: [], updatedAt: 0, serverNow: Date.now() });
  const response = await stub.fetch(new Request(`https://tournament.internal/view?tournamentId=${encodeURIComponent(tournamentId)}`));
  return new Response(response.body, { status: response.status, headers: response.headers });
}

export class ViewingTournamentRegistry extends BaseTournamentRegistry {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== 'tournament.internal') return super.fetch(request);
    const ctx = (this as unknown as { ctx: DurableObjectState }).ctx;

    if (request.method === 'POST' && url.pathname === '/view-game') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const tournamentId = String(body.tournamentId ?? '').trim();
      const roomCode = String(body.roomCode ?? '').trim().toUpperCase();
      const white = cleanPlayer(body.white);
      const black = cleanPlayer(body.black);
      if (!TOURNAMENT_ID.test(tournamentId) || !ROOM_CODE.test(roomCode) || !white || !black) {
        return json({ error: 'Invalid tournament game record.' }, 400);
      }

      const store = (await ctx.storage.get<GameStore>(STORE_KEY)) ?? {};
      const games = store[tournamentId] ?? [];
      const existingIndex = games.findIndex(game => game.roomCode === roomCode);
      const existing = existingIndex >= 0 ? games[existingIndex] : null;
      const now = Date.now();
      const winner: Color | null = body.winner === 'white' || body.winner === 'black' ? body.winner : null;
      const complete = body.complete === true || Boolean(body.result);
      const next: StoredTournamentGame = {
        tournamentId,
        roomCode,
        round: Math.max(1, Math.min(64, Math.floor(Number(body.round) || existing?.round || 1))),
        white,
        black,
        startedAt: existing?.startedAt ?? (Number.isFinite(Number(body.startedAt)) ? Number(body.startedAt) : now),
        updatedAt: now,
        status: existing?.status === 'complete' || complete ? 'complete' : 'live',
        result: complete ? String(body.result ?? existing?.result ?? 'Game complete').slice(0, 180) : existing?.result ?? null,
        winner: complete ? winner : existing?.winner ?? null,
      };
      if (existingIndex >= 0) games[existingIndex] = next;
      else games.push(next);
      store[tournamentId] = games.slice(-4096);
      await ctx.storage.put(STORE_KEY, store);
      return json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/view') {
      const tournamentId = url.searchParams.get('tournamentId') ?? '';
      if (!TOURNAMENT_ID.test(tournamentId)) return json({ error: 'Invalid tournament id.' }, 400);
      const store = (await ctx.storage.get<GameStore>(STORE_KEY)) ?? {};
      const games = [...(store[tournamentId] ?? [])].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'live' ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
      const updatedAt = games.reduce((latest, game) => Math.max(latest, game.updatedAt), 0);
      return json({
        tournamentId,
        games: games.map(publicGame),
        standings: standingsFor(games),
        liveGames: games.filter(game => game.status === 'live').length,
        completedGames: games.filter(game => game.status === 'complete').length,
        updatedAt,
        serverNow: Date.now(),
      });
    }

    return super.fetch(request);
  }
}
