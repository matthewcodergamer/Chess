import { DurableObject } from 'cloudflare:workers';

type SeatColor = 'white' | 'black';
type RoomSeat = { code: string; token: string; color: SeatColor };
type PresenceRecord = { name: string; lastSeen: number };
type TicketRecord = {
  id: string;
  name: string;
  presenceId: string;
  createdAt: number;
  status: 'waiting' | 'matched';
  seat: RoomSeat | null;
  opponent: string | null;
  matchedAt: number | null;
};
type LobbyState = {
  presence: Record<string, PresenceRecord>;
  queue: string[];
  tickets: Record<string, TicketRecord>;
};

export type MatchmakerEnv = {
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  ROOMS: DurableObjectNamespace;
};

const PRESENCE_TTL_MS = 60_000;
const QUEUE_TTL_MS = 3 * 60_000;
const MATCH_TTL_MS = 15 * 60_000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function normalizeName(value: unknown): string {
  const name = String(value ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 28);
  return name || 'Guest';
}

function normalizePresenceId(value: unknown): string {
  const id = String(value ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 96);
  return id.length >= 8 ? id : crypto.randomUUID();
}

function roomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
}

function ticketId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export async function handleMatchmakerRequest(request: Request, env: MatchmakerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const handled = url.pathname === '/presence'
    || url.pathname === '/presence/ping'
    || url.pathname === '/matchmaking/enqueue'
    || url.pathname === '/matchmaking/status'
    || url.pathname === '/matchmaking/cancel';
  if (!handled) return null;

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  const target = new URL(`https://matchmaker.internal${url.pathname}${url.search}`);
  const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('qqurz-global-lobby'));
  return stub.fetch(new Request(target, {
    method: request.method,
    headers: { 'content-type': request.headers.get('content-type') ?? 'application/json' },
    body,
  }));
}

export class Matchmaker extends DurableObject<MatchmakerEnv> {
  private state: LobbyState = { presence: {}, queue: [], tickets: {} };

  constructor(ctx: DurableObjectState, env: MatchmakerEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.state = (await this.ctx.storage.get<LobbyState>('lobby')) ?? { presence: {}, queue: [], tickets: {} };
      this.prune(Date.now());
    });
  }

  private prune(now: number): void {
    for (const [id, record] of Object.entries(this.state.presence)) {
      if (now - record.lastSeen > PRESENCE_TTL_MS) delete this.state.presence[id];
    }

    for (const [id, ticket] of Object.entries(this.state.tickets)) {
      const age = now - (ticket.matchedAt ?? ticket.createdAt);
      if ((ticket.status === 'waiting' && age > QUEUE_TTL_MS) || (ticket.status === 'matched' && age > MATCH_TTL_MS)) {
        delete this.state.tickets[id];
      }
    }

    this.state.queue = this.state.queue.filter(id => this.state.tickets[id]?.status === 'waiting');
  }

  private onlinePlayers(): number {
    return Object.keys(this.state.presence).length;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('lobby', this.state);
  }

  private touchPresence(presenceId: string, name: string, now: number): void {
    this.state.presence[presenceId] = { name, lastSeen: now };
  }

  private ticketPayload(ticket: TicketRecord) {
    return {
      ticket: ticket.id,
      status: ticket.status,
      seat: ticket.seat,
      opponent: ticket.opponent,
      onlinePlayers: this.onlinePlayers(),
    };
  }

  private async allocateRoom(firstName: string, secondName: string): Promise<{ first: RoomSeat; second: RoomSeat }> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = roomCode();
      const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
      const created = await room.fetch(new Request('https://room.internal/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name: firstName }),
      }));
      if (created.status === 409) continue;
      if (!created.ok) throw new Error('Could not create a matchmaking room.');
      const first = await created.json() as RoomSeat;

      const joined = await room.fetch(new Request('https://room.internal/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: secondName }),
      }));
      if (!joined.ok) throw new Error('Could not seat the matched opponent.');
      const second = await joined.json() as RoomSeat;
      return { first, second };
    }
    throw new Error('Could not allocate a matchmaking room.');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    this.prune(now);

    if (request.method === 'GET' && url.pathname === '/presence') {
      await this.persist();
      return json({ onlinePlayers: this.onlinePlayers() });
    }

    if (request.method === 'POST' && url.pathname === '/presence/ping') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const presenceId = normalizePresenceId(body.presenceId);
      this.touchPresence(presenceId, normalizeName(body.name), now);
      await this.persist();
      return json({ presenceId, onlinePlayers: this.onlinePlayers() });
    }

    if (request.method === 'POST' && url.pathname === '/matchmaking/enqueue') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const name = normalizeName(body.name);
      const presenceId = normalizePresenceId(body.presenceId);
      this.touchPresence(presenceId, name, now);

      const previous = Object.values(this.state.tickets).find(ticket => ticket.presenceId === presenceId && ticket.status === 'waiting');
      if (previous) {
        await this.persist();
        return json(this.ticketPayload(previous));
      }

      const opponentId = this.state.queue.find(id => {
        const candidate = this.state.tickets[id];
        return candidate?.status === 'waiting' && candidate.presenceId !== presenceId;
      });

      const id = ticketId();
      const newcomer: TicketRecord = {
        id,
        name,
        presenceId,
        createdAt: now,
        status: 'waiting',
        seat: null,
        opponent: null,
        matchedAt: null,
      };
      this.state.tickets[id] = newcomer;

      if (!opponentId) {
        this.state.queue.push(id);
        await this.persist();
        return json(this.ticketPayload(newcomer));
      }

      const opponent = this.state.tickets[opponentId];
      try {
        const seats = await this.allocateRoom(opponent.name, newcomer.name);
        opponent.status = 'matched';
        opponent.seat = seats.first;
        opponent.opponent = newcomer.name;
        opponent.matchedAt = now;
        newcomer.status = 'matched';
        newcomer.seat = seats.second;
        newcomer.opponent = opponent.name;
        newcomer.matchedAt = now;
        this.state.queue = this.state.queue.filter(item => item !== opponentId && item !== id);
        await this.persist();
        return json(this.ticketPayload(newcomer));
      } catch (error) {
        delete this.state.tickets[id];
        await this.persist();
        return json({ error: error instanceof Error ? error.message : 'Matchmaking failed.' }, 503);
      }
    }

    if (request.method === 'GET' && url.pathname === '/matchmaking/status') {
      const id = String(url.searchParams.get('ticket') ?? '');
      const ticket = this.state.tickets[id];
      if (!ticket) return json({ error: 'That matchmaking ticket expired.' }, 404);
      await this.persist();
      return json(this.ticketPayload(ticket));
    }

    if (request.method === 'POST' && url.pathname === '/matchmaking/cancel') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const id = String(body.ticket ?? '');
      const ticket = this.state.tickets[id];
      if (ticket?.status === 'waiting') {
        delete this.state.tickets[id];
        this.state.queue = this.state.queue.filter(item => item !== id);
      }
      await this.persist();
      return json({ cancelled: true, onlinePlayers: this.onlinePlayers() });
    }

    return json({ error: 'Not found.' }, 404);
  }
}
