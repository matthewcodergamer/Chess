import { Matchmaker as BaseMatchmaker, type MatchmakerEnv } from '../../matchmaker';

type PresenceState = 'online' | 'away' | 'game';
type RegionRecord = { colo: string; country: string; continent: string };
type PresenceRecord = {
  name: string;
  accountId: string | null;
  lastSeen: number;
  state: PresenceState;
  roomCode: string | null;
  region: RegionRecord;
};
type TicketRecord = {
  id: string;
  name: string;
  accountId: string | null;
  presenceId: string;
  createdAt: number;
  status: 'waiting' | 'matched';
  matchedAt: number | null;
};
type LobbyState = {
  presence: Record<string, PresenceRecord>;
  queue: string[];
  tickets: Record<string, TicketRecord>;
};

type MatchmakerInternals = {
  env: MatchmakerEnv & { INTEGRITY_ADMIN_SECRET?: string };
  state: LobbyState;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function adminAuthorized(request: Request, secret: string | undefined): boolean {
  const expected = secret ?? '';
  const supplied = request.headers.get('x-integrity-admin') ?? '';
  if (expected.length < 24 || supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return mismatch === 0;
}

export class OperationalMatchmaker extends BaseMatchmaker {
  private operationsInternals(): MatchmakerInternals {
    return this as unknown as MatchmakerInternals;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/internal/admin/presence') return super.fetch(request);
    const { env } = this.operationsInternals();
    if (!adminAuthorized(request, env.INTEGRITY_ADMIN_SECRET)) return json({ error: 'Unauthorized operations access.' }, 401);
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

    // Reuse the public presence request to run the base class pruning/persist path
    // before exposing the privileged detailed snapshot.
    const publicSnapshot = await super.fetch(new Request('https://matchmaker.internal/presence'));
    const publicPayload = await publicSnapshot.json().catch(() => ({})) as {
      onlinePlayers?: number;
      presence?: { online?: number; away?: number; game?: number };
    };
    const state = this.operationsInternals().state;
    const now = Date.now();
    const players = Object.entries(state.presence)
      .map(([presenceId, record]) => ({
        presenceId,
        name: record.name,
        accountId: record.accountId,
        state: record.state,
        roomCode: record.roomCode,
        lastSeen: record.lastSeen,
        idleMs: Math.max(0, now - record.lastSeen),
        region: record.region,
      }))
      .sort((a, b) => {
        const priority = (stateValue: PresenceState) => stateValue === 'game' ? 0 : stateValue === 'online' ? 1 : 2;
        return priority(a.state) - priority(b.state) || b.lastSeen - a.lastSeen;
      })
      .slice(0, 500);
    const waitingTickets = state.queue
      .map(id => state.tickets[id])
      .filter((ticket): ticket is TicketRecord => Boolean(ticket && ticket.status === 'waiting'))
      .map(ticket => ({ id: ticket.id, name: ticket.name, accountId: ticket.accountId, presenceId: ticket.presenceId, createdAt: ticket.createdAt, waitedMs: Math.max(0, now - ticket.createdAt) }))
      .slice(0, 250);

    return json({
      generatedAt: now,
      onlinePlayers: Number(publicPayload.onlinePlayers ?? players.length),
      counts: {
        online: Number(publicPayload.presence?.online ?? players.filter(player => player.state === 'online').length),
        away: Number(publicPayload.presence?.away ?? players.filter(player => player.state === 'away').length),
        game: Number(publicPayload.presence?.game ?? players.filter(player => player.state === 'game').length),
      },
      queueSize: waitingTickets.length,
      players,
      waitingTickets,
    });
  }
}
