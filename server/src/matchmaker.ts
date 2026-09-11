import { DurableObject } from 'cloudflare:workers';
import { handleAccountRequest, resolveAccountSession, type AccountEnv } from './accounts';
import { normalizeTimeControl, ratingClassForTimeControl, type TimeControl } from '../../shared/timeControl';

type SeatColor = 'white' | 'black';
type RoomSeat = { code: string; token: string; color: SeatColor };
type PresenceState = 'online' | 'away' | 'game';
type MatchVariant = 'chess960';
type RegionPreference = 'nearest' | 'regional' | 'global';
type RegionRecord = { colo: string; country: string; continent: string };
type PresenceRecord = {
  name: string;
  accountId: string | null;
  lastSeen: number;
  state: PresenceState;
  roomCode: string | null;
  region: RegionRecord;
};
type MatchCriteria = {
  variant: MatchVariant;
  ratingRange: number;
  timeControl: TimeControl;
  regionPreference: RegionPreference;
  maxLatencyMs: number;
};
type TicketRecord = {
  id: string;
  name: string;
  accountId: string | null;
  presenceId: string;
  createdAt: number;
  status: 'waiting' | 'matched';
  seat: RoomSeat | null;
  opponent: string | null;
  opponentRating: number | null;
  rating: number;
  ratingDeviation: number;
  provisional: boolean;
  criteria: MatchCriteria;
  region: RegionRecord;
  estimatedLatencyMs: number | null;
  matchedAt: number | null;
};
type LobbyState = {
  presence: Record<string, PresenceRecord>;
  queue: string[];
  tickets: Record<string, TicketRecord>;
};
type PresenceCounts = { online: number; away: number; game: number };

type TrustedAccountPayload = {
  account?: {
    id?: string;
    displayName?: string;
    chess960Ratings?: Record<string, { rating?: number; deviation?: number; provisional?: boolean }>;
  };
};

export type MatchmakerEnv = AccountEnv & {
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  ROOMS: DurableObjectNamespace;
};

const PRESENCE_TTL_MS = 75_000;
const QUEUE_TTL_MS = 10 * 60_000;
const MATCH_TTL_MS = 20 * 60_000;
const RATING_EXPAND_EVERY_MS = 10_000;
const RATING_EXPAND_STEP = 75;
const MAX_RATING_RANGE = 1200;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_REGION: RegionRecord = { colo: '', country: '', continent: '' };

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

function normalizePresenceState(value: unknown): PresenceState | 'offline' {
  if (value === 'away' || value === 'game' || value === 'offline') return value;
  return 'online';
}

function normalizeRegionPreference(value: unknown): RegionPreference {
  if (value === 'nearest' || value === 'global') return value;
  return 'regional';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function roomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
}

function ticketId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function regionFromHeaders(headers: Headers): RegionRecord {
  return {
    colo: (headers.get('x-qqurz-colo') ?? '').trim().toUpperCase().slice(0, 12),
    country: (headers.get('x-qqurz-country') ?? '').trim().toUpperCase().slice(0, 2),
    continent: (headers.get('x-qqurz-continent') ?? '').trim().toUpperCase().slice(0, 3),
  };
}

function observedRegion(request: Request): RegionRecord {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const value = (key: string, max: number) => typeof cf?.[key] === 'string' ? String(cf[key]).trim().toUpperCase().slice(0, max) : '';
  return { colo: value('colo', 12), country: value('country', 2), continent: value('continent', 3) };
}

function criteriaFromBody(body: Record<string, unknown>): MatchCriteria {
  const rawTimeControl = body.timeControl && typeof body.timeControl === 'object'
    ? body.timeControl as Record<string, unknown>
    : undefined;
  const timeControl = normalizeTimeControl(rawTimeControl ? {
    id: typeof rawTimeControl.id === 'string' ? rawTimeControl.id : undefined,
    baseMs: Number(rawTimeControl.baseMs),
    incrementMs: Number(rawTimeControl.incrementMs),
  } : undefined, '10+5');
  return {
    variant: 'chess960',
    ratingRange: clampInteger(body.ratingRange, 50, 600, 200),
    timeControl,
    regionPreference: normalizeRegionPreference(body.regionPreference),
    maxLatencyMs: clampInteger(body.maxLatencyMs, 40, 300, 140),
  };
}

function expandedRatingRange(ticket: TicketRecord, now: number): number {
  const steps = Math.max(0, Math.floor((now - ticket.createdAt) / RATING_EXPAND_EVERY_MS));
  return Math.min(MAX_RATING_RANGE, ticket.criteria.ratingRange + steps * RATING_EXPAND_STEP);
}

function estimatedLatencyMs(a: RegionRecord, b: RegionRecord): number {
  if (a.colo && b.colo && a.colo === b.colo) return 20;
  if (a.country && b.country && a.country === b.country) return 45;
  if (a.continent && b.continent && a.continent === b.continent) return 90;
  if (!a.continent || !b.continent) return 120;
  return 180;
}

function regionPreferenceAllows(preference: RegionPreference, a: RegionRecord, b: RegionRecord): boolean {
  if (preference === 'global') return true;
  if (preference === 'nearest') {
    if (a.country && b.country) return a.country === b.country;
    if (a.continent && b.continent) return a.continent === b.continent;
    return true;
  }
  if (a.continent && b.continent) return a.continent === b.continent;
  return true;
}

function controlsMatch(a: TimeControl, b: TimeControl): boolean {
  return a.baseMs === b.baseMs && a.incrementMs === b.incrementMs;
}

async function trustedRatingForRequest(request: Request, env: MatchmakerEnv, timeControl: TimeControl): Promise<{ rating: number; deviation: number; provisional: boolean } | null> {
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  const response = await handleAccountRequest(new Request('https://accounts.internal/account/me', {
    headers: {
      authorization: auth,
      'user-agent': request.headers.get('user-agent') ?? '',
    },
  }), env);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({})) as TrustedAccountPayload;
  const ratingClass = ratingClassForTimeControl(timeControl.baseMs, timeControl.incrementMs);
  const rating = payload.account?.chess960Ratings?.[ratingClass];
  if (!rating) return null;
  return {
    rating: clampInteger(rating.rating, 100, 4000, 1500),
    deviation: clampInteger(rating.deviation, 30, 350, 350),
    provisional: Boolean(rating.provisional),
  };
}

export async function handleMatchmakerRequest(request: Request, env: MatchmakerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const handled = url.pathname === '/presence'
    || url.pathname === '/presence/ping'
    || url.pathname === '/matchmaking/enqueue'
    || url.pathname === '/matchmaking/status'
    || url.pathname === '/matchmaking/cancel';
  if (!handled) return null;

  const identity = await resolveAccountSession(request, env);
  const bodyText = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  let body: Record<string, unknown> = {};
  if (bodyText) {
    try { body = JSON.parse(bodyText) as Record<string, unknown>; } catch { body = {}; }
  }
  const criteria = url.pathname === '/matchmaking/enqueue' ? criteriaFromBody(body) : null;
  const trustedRating = criteria ? await trustedRatingForRequest(request, env, criteria.timeControl) : null;
  const region = observedRegion(request);
  const target = new URL(`https://matchmaker.internal${url.pathname}${url.search}`);
  const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('qqurz-global-lobby'));
  const headers = new Headers({ 'content-type': request.headers.get('content-type') ?? 'application/json' });
  if (identity) {
    headers.set('x-qqurz-account-id', identity.id);
    headers.set('x-qqurz-account-name', identity.displayName);
  }
  if (trustedRating) {
    headers.set('x-qqurz-rating', String(trustedRating.rating));
    headers.set('x-qqurz-rating-deviation', String(trustedRating.deviation));
    headers.set('x-qqurz-rating-provisional', trustedRating.provisional ? '1' : '0');
  }
  if (region.colo) headers.set('x-qqurz-colo', region.colo);
  if (region.country) headers.set('x-qqurz-country', region.country);
  if (region.continent) headers.set('x-qqurz-continent', region.continent);
  return stub.fetch(new Request(target, { method: request.method, headers, body: bodyText }));
}

export class Matchmaker extends DurableObject<MatchmakerEnv> {
  private state: LobbyState = { presence: {}, queue: [], tickets: {} };

  constructor(ctx: DurableObjectState, env: MatchmakerEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = (await this.ctx.storage.get<LobbyState>('lobby')) ?? { presence: {}, queue: [], tickets: {} };
      this.state = {
        presence: stored.presence ?? {},
        queue: Array.isArray(stored.queue) ? stored.queue : [],
        tickets: stored.tickets ?? {},
      };
      for (const record of Object.values(this.state.presence)) {
        record.accountId ??= null;
        record.state ??= 'online';
        record.roomCode ??= null;
        record.region ??= { ...DEFAULT_REGION };
      }
      // Match tickets are intentionally short-lived. Discard entries from the
      // pre-criteria schema rather than guessing security-sensitive fields.
      for (const [id, ticket] of Object.entries(this.state.tickets)) {
        if (!ticket.criteria || !ticket.region || !Number.isFinite(ticket.rating)) delete this.state.tickets[id];
      }
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

  private presenceCounts(): PresenceCounts {
    const counts: PresenceCounts = { online: 0, away: 0, game: 0 };
    for (const record of Object.values(this.state.presence)) counts[record.state] += 1;
    return counts;
  }

  private onlinePlayers(): number {
    const counts = this.presenceCounts();
    return counts.online + counts.away + counts.game;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('lobby', this.state);
  }

  private touchPresence(presenceId: string, name: string, accountId: string | null, state: PresenceState, region: RegionRecord, now: number, roomCode: string | null = null): void {
    this.state.presence[presenceId] = { name, accountId, lastSeen: now, state, roomCode, region };
  }

  private ticketPayload(ticket: TicketRecord, now = Date.now()) {
    return {
      ticket: ticket.id,
      status: ticket.status,
      seat: ticket.seat,
      opponent: ticket.opponent,
      opponentRating: ticket.opponentRating,
      rating: ticket.rating,
      ratingDeviation: ticket.ratingDeviation,
      provisional: ticket.provisional,
      criteria: ticket.criteria,
      search: {
        waitedMs: Math.max(0, now - ticket.createdAt),
        ratingRange: expandedRatingRange(ticket, now),
        estimatedLatencyMs: ticket.estimatedLatencyMs,
      },
      onlinePlayers: this.onlinePlayers(),
      presence: this.presenceCounts(),
    };
  }

  private candidateAllowed(newcomer: TicketRecord, candidate: TicketRecord, now: number): boolean {
    if (candidate.status !== 'waiting' || candidate.presenceId === newcomer.presenceId) return false;
    if (newcomer.accountId && candidate.accountId && newcomer.accountId === candidate.accountId) return false;
    if (newcomer.criteria.variant !== candidate.criteria.variant) return false;
    if (!controlsMatch(newcomer.criteria.timeControl, candidate.criteria.timeControl)) return false;
    const ratingDifference = Math.abs(newcomer.rating - candidate.rating);
    if (ratingDifference > expandedRatingRange(newcomer, now) || ratingDifference > expandedRatingRange(candidate, now)) return false;
    if (!regionPreferenceAllows(newcomer.criteria.regionPreference, newcomer.region, candidate.region)) return false;
    if (!regionPreferenceAllows(candidate.criteria.regionPreference, candidate.region, newcomer.region)) return false;
    const latency = estimatedLatencyMs(newcomer.region, candidate.region);
    if (latency > newcomer.criteria.maxLatencyMs || latency > candidate.criteria.maxLatencyMs) return false;
    return true;
  }

  private pickOpponent(newcomer: TicketRecord, now: number): TicketRecord | null {
    let best: { ticket: TicketRecord; score: number } | null = null;
    for (const id of this.state.queue) {
      const candidate = this.state.tickets[id];
      if (!candidate || !this.candidateAllowed(newcomer, candidate, now)) continue;
      const ratingDifference = Math.abs(newcomer.rating - candidate.rating);
      const latency = estimatedLatencyMs(newcomer.region, candidate.region);
      const waitedSeconds = Math.max(0, (now - candidate.createdAt) / 1000);
      const score = ratingDifference + latency * 1.5 - Math.min(120, waitedSeconds) * 0.35;
      if (!best || score < best.score) best = { ticket: candidate, score };
    }
    return best?.ticket ?? null;
  }

  private async allocateRoom(first: TicketRecord, second: TicketRecord): Promise<{ first: RoomSeat; second: RoomSeat }> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = roomCode();
      const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
      const created = await room.fetch(new Request('https://room.internal/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name: first.name,
          accountId: first.accountId,
          timeControl: first.criteria.timeControl,
        }),
      }));
      if (created.status === 409) continue;
      if (!created.ok) throw new Error('Could not create a matchmaking room.');
      const firstSeat = await created.json() as RoomSeat;

      const joined = await room.fetch(new Request('https://room.internal/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: second.name, accountId: second.accountId }),
      }));
      if (!joined.ok) throw new Error('Could not seat the matched opponent.');
      const secondSeat = await joined.json() as RoomSeat;
      return { first: firstSeat, second: secondSeat };
    }
    throw new Error('Could not allocate a matchmaking room.');
  }

  private markInGame(ticket: TicketRecord, roomCodeValue: string, now: number): void {
    const presence = this.state.presence[ticket.presenceId];
    if (!presence) return;
    presence.state = 'game';
    presence.roomCode = roomCodeValue;
    presence.lastSeen = now;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    this.prune(now);
    const authenticatedName = request.headers.get('x-qqurz-account-name');
    const accountId = request.headers.get('x-qqurz-account-id') || null;
    const region = regionFromHeaders(request.headers);

    if (request.method === 'GET' && url.pathname === '/presence') {
      await this.persist();
      return json({ onlinePlayers: this.onlinePlayers(), presence: this.presenceCounts() });
    }

    if (request.method === 'POST' && url.pathname === '/presence/ping') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const presenceId = normalizePresenceId(body.presenceId);
      const requestedState = normalizePresenceState(body.state);
      if (requestedState === 'offline') {
        delete this.state.presence[presenceId];
        await this.persist();
        return json({ presenceId, state: 'offline', onlinePlayers: this.onlinePlayers(), presence: this.presenceCounts() });
      }
      const name = authenticatedName ? normalizeName(authenticatedName) : normalizeName(body.name);
      const roomCodeValue = requestedState === 'game' ? this.state.presence[presenceId]?.roomCode ?? null : null;
      this.touchPresence(presenceId, name, accountId, requestedState, region, now, roomCodeValue);
      await this.persist();
      return json({ presenceId, state: requestedState, onlinePlayers: this.onlinePlayers(), presence: this.presenceCounts() });
    }

    if (request.method === 'POST' && url.pathname === '/matchmaking/enqueue') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const name = authenticatedName ? normalizeName(authenticatedName) : normalizeName(body.name);
      const presenceId = normalizePresenceId(body.presenceId);
      const criteria = criteriaFromBody(body);
      const rating = clampInteger(request.headers.get('x-qqurz-rating'), 100, 4000, 1500);
      const ratingDeviation = clampInteger(request.headers.get('x-qqurz-rating-deviation'), 30, 350, 350);
      const provisional = request.headers.get('x-qqurz-rating-provisional') !== '0';
      this.touchPresence(presenceId, name, accountId, 'online', region, now);

      const previous = Object.values(this.state.tickets).find(ticket => ticket.status === 'waiting'
        && (ticket.presenceId === presenceId || Boolean(accountId && ticket.accountId === accountId)));
      if (previous) {
        await this.persist();
        return json(this.ticketPayload(previous, now));
      }

      const id = ticketId();
      const newcomer: TicketRecord = {
        id,
        name,
        accountId,
        presenceId,
        createdAt: now,
        status: 'waiting',
        seat: null,
        opponent: null,
        opponentRating: null,
        rating,
        ratingDeviation,
        provisional,
        criteria,
        region,
        estimatedLatencyMs: null,
        matchedAt: null,
      };
      this.state.tickets[id] = newcomer;

      const opponent = this.pickOpponent(newcomer, now);
      if (!opponent) {
        this.state.queue.push(id);
        await this.persist();
        return json(this.ticketPayload(newcomer, now));
      }

      try {
        const seats = await this.allocateRoom(opponent, newcomer);
        const latency = estimatedLatencyMs(opponent.region, newcomer.region);
        opponent.status = 'matched';
        opponent.seat = seats.first;
        opponent.opponent = newcomer.name;
        opponent.opponentRating = newcomer.rating;
        opponent.estimatedLatencyMs = latency;
        opponent.matchedAt = now;
        newcomer.status = 'matched';
        newcomer.seat = seats.second;
        newcomer.opponent = opponent.name;
        newcomer.opponentRating = opponent.rating;
        newcomer.estimatedLatencyMs = latency;
        newcomer.matchedAt = now;
        this.markInGame(opponent, seats.first.code, now);
        this.markInGame(newcomer, seats.second.code, now);
        this.state.queue = this.state.queue.filter(item => item !== opponent.id && item !== id);
        await this.persist();
        return json(this.ticketPayload(newcomer, now));
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
      return json(this.ticketPayload(ticket, now));
    }

    if (request.method === 'POST' && url.pathname === '/matchmaking/cancel') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const id = String(body.ticket ?? '');
      const ticket = this.state.tickets[id];
      if (ticket?.status === 'waiting') {
        delete this.state.tickets[id];
        this.state.queue = this.state.queue.filter(item => item !== id);
        const presence = this.state.presence[ticket.presenceId];
        if (presence) {
          presence.state = 'online';
          presence.roomCode = null;
          presence.lastSeen = now;
        }
      }
      await this.persist();
      return json({ cancelled: true, onlinePlayers: this.onlinePlayers(), presence: this.presenceCounts() });
    }

    return json({ error: 'Not found.' }, 404);
  }
}
