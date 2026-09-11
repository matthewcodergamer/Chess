import { ratingClassForTimeControl, type Chess960RatingClass } from '../../shared/timeControl';
import { handleAccountRequest, resolveAccountSession, type AccountEnv } from './accounts';
import { AuthoritativeChessRoom } from './authoritativeRoom';
import { recordTournamentGame, type TournamentViewingEnv } from './tournamentViewing';

type Color = 'white' | 'black';
type RatingBook = Partial<Record<Chess960RatingClass, number>>;
type ViewerAttachment = { role?: 'spectator'; token?: string };
type ViewMetadata = {
  tournamentId: string | null;
  ratingByToken: Record<string, number | null>;
  resultRecordedAt: number | null;
};

type InternalRoom = {
  code: string;
  createdAt: number;
  session: {
    result: string | null;
    winner: Color | null;
    clocks: { baseMs: number; incrementMs: number };
  };
  players: {
    white: { name: string; token: string; accountId: string | null };
    black: { name: string; token: string; accountId: string | null } | null;
  };
};

export type SpectatorRoomEnv = AccountEnv & TournamentViewingEnv & {
  ROOMS: DurableObjectNamespace<SpectatorChessRoom>;
};

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOURNAMENT_ID = /^knockout-\d+-\d+$/;
const METADATA_KEY = 'spectator:view-metadata:v1';

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

function cleanTournamentId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return TOURNAMENT_ID.test(id) ? id : null;
}

function ratingFor(book: RatingBook, baseMs: number, incrementMs: number): number | null {
  const value = book[ratingClassForTimeControl(baseMs, incrementMs)];
  return Number.isFinite(value) ? Math.round(Number(value)) : null;
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

function roomRoute(pathname: string): { code: string; action: 'join' | 'spectate' } | null {
  const match = /^\/rooms\/([A-Z0-9]{6})\/(join|spectate)$/i.exec(pathname);
  return match ? { code: match[1].toUpperCase(), action: match[2].toLowerCase() as 'join' | 'spectate' } : null;
}

export async function handleSpectatorRoomRequest(request: Request, env: SpectatorRoomEnv): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/rooms') {
    const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
    const identity = await resolveAccountSession(request, env);
    const ratings = await ratingBookForRequest(request, env);
    const name = identity?.displayName ?? cleanName(body.name);
    const tournamentId = cleanTournamentId(body.tournamentId);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = roomCode();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const internal = await stub.fetch(new Request('https://room.internal/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name,
          accountId: identity?.id ?? null,
          timeControl: body.timeControl,
          tournamentTemplateId: body.tournamentTemplateId,
          tournamentId,
          ratings,
        }),
      }));
      if (internal.status === 409) continue;
      return internal;
    }
    return json({ error: 'Could not allocate a room code. Try again.' }, 503);
  }

  const route = roomRoute(url.pathname);
  if (!route) return null;
  const stub = env.ROOMS.get(env.ROOMS.idFromName(route.code));

  if (route.action === 'join' && request.method === 'POST') {
    const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
    const identity = await resolveAccountSession(request, env);
    const ratings = await ratingBookForRequest(request, env);
    return stub.fetch(new Request('https://room.internal/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: identity?.displayName ?? cleanName(body.name), accountId: identity?.id ?? null, ratings }),
    }));
  }

  if (route.action === 'spectate' && request.method === 'GET') return stub.fetch(request);
  return null;
}

export class SpectatorChessRoom extends AuthoritativeChessRoom {
  private internals(): { room: InternalRoom | null; ctx: DurableObjectState; snapshotForToken: (token: string | null) => any; env: SpectatorRoomEnv } {
    return this as unknown as { room: InternalRoom | null; ctx: DurableObjectState; snapshotForToken: (token: string | null) => any; env: SpectatorRoomEnv };
  }

  private async metadata(): Promise<ViewMetadata> {
    const { ctx } = this.internals();
    return (await ctx.storage.get<ViewMetadata>(METADATA_KEY)) ?? { tournamentId: null, ratingByToken: {}, resultRecordedAt: null };
  }

  private async putMetadata(metadata: ViewMetadata): Promise<void> {
    await this.internals().ctx.storage.put(METADATA_KEY, metadata);
  }

  private async spectatorSnapshot(): Promise<any> {
    const { room, snapshotForToken } = this.internals();
    if (!room) throw new Error('Room state unavailable.');
    const metadata = await this.metadata();
    const snapshot = snapshotForToken(null);
    if (snapshot.players?.white) snapshot.players.white.rating = metadata.ratingByToken[room.players.white.token] ?? null;
    if (snapshot.players?.black && room.players.black) snapshot.players.black.rating = metadata.ratingByToken[room.players.black.token] ?? null;
    snapshot.spectator = true;
    snapshot.permissions = { readOnly: true, analysis: false };
    snapshot.tournamentId = metadata.tournamentId;
    return snapshot;
  }

  private async sendSpectatorSnapshot(ws: WebSocket): Promise<void> {
    try { ws.send(JSON.stringify({ type: 'snapshot', room: await this.spectatorSnapshot() })); }
    catch { /* socket closing */ }
  }

  private async broadcastSpectators(): Promise<void> {
    const { room, ctx } = this.internals();
    if (!room) return;
    let message: string;
    try { message = JSON.stringify({ type: 'snapshot', room: await this.spectatorSnapshot() }); }
    catch { return; }
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as ViewerAttachment | null;
      if (attachment?.role !== 'spectator') continue;
      try { ws.send(message); } catch { /* socket closing */ }
    }
  }

  private async recordTournamentStart(): Promise<void> {
    const { room, env } = this.internals();
    if (!room?.players.black) return;
    const metadata = await this.metadata();
    if (!metadata.tournamentId) return;
    await recordTournamentGame(env, {
      tournamentId: metadata.tournamentId,
      roomCode: room.code,
      round: 1,
      white: { name: room.players.white.name, rating: metadata.ratingByToken[room.players.white.token] ?? null, accountId: room.players.white.accountId },
      black: { name: room.players.black.name, rating: metadata.ratingByToken[room.players.black.token] ?? null, accountId: room.players.black.accountId },
      startedAt: room.createdAt,
    });
  }

  private async recordTournamentResultIfNeeded(): Promise<void> {
    const { room, env } = this.internals();
    if (!room?.players.black || !room.session.result) return;
    const metadata = await this.metadata();
    if (!metadata.tournamentId || metadata.resultRecordedAt) return;
    await recordTournamentGame(env, {
      tournamentId: metadata.tournamentId,
      roomCode: room.code,
      round: 1,
      white: { name: room.players.white.name, rating: metadata.ratingByToken[room.players.white.token] ?? null, accountId: room.players.white.accountId },
      black: { name: room.players.black.name, rating: metadata.ratingByToken[room.players.black.token] ?? null, accountId: room.players.black.accountId },
      startedAt: room.createdAt,
      result: room.session.result,
      winner: room.session.winner,
      complete: true,
    });
    metadata.resultRecordedAt = Date.now();
    await this.putMetadata(metadata);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const internalCreate = url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST';
    const internalJoin = url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST';
    const body = internalCreate || internalJoin
      ? await request.clone().json().catch(() => ({})) as { tournamentId?: unknown; ratings?: RatingBook }
      : null;

    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket' && /\/spectate$/i.test(url.pathname)) {
      if (!this.internals().room) return json({ error: 'That room does not exist.' }, 404);
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.internals().ctx.acceptWebSocket(server);
      server.serializeAttachment({ role: 'spectator' } satisfies ViewerAttachment);
      await this.sendSpectatorSnapshot(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    const response = await super.fetch(request);
    if (!response.ok) return response;

    if (internalCreate) {
      const room = this.internals().room;
      if (room) {
        const metadata: ViewMetadata = {
          tournamentId: cleanTournamentId(body?.tournamentId),
          ratingByToken: {},
          resultRecordedAt: null,
        };
        metadata.ratingByToken[room.players.white.token] = ratingFor(body?.ratings ?? {}, room.session.clocks.baseMs, room.session.clocks.incrementMs);
        await this.putMetadata(metadata);
      }
    } else if (internalJoin) {
      const room = this.internals().room;
      if (room?.players.black) {
        const metadata = await this.metadata();
        metadata.ratingByToken[room.players.black.token] = ratingFor(body?.ratings ?? {}, room.session.clocks.baseMs, room.session.clocks.incrementMs);
        await this.putMetadata(metadata);
        await this.recordTournamentStart();
        await this.broadcastSpectators();
      }
    } else if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      await this.broadcastSpectators();
    }
    return response;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as ViewerAttachment | null;
    if (attachment?.role === 'spectator') {
      let payload: { type?: unknown } = {};
      try { payload = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as { type?: unknown }; }
      catch { /* handled as read-only below */ }
      if (payload.type === 'sync_request') {
        await this.sendSpectatorSnapshot(ws);
        return;
      }
      try { ws.send(JSON.stringify({ type: 'error', message: 'Spectator connections are read-only.' })); } catch { /* socket closing */ }
      return;
    }
    await super.webSocketMessage(ws, message);
    await this.recordTournamentResultIfNeeded();
    await this.broadcastSpectators();
  }

  override async webSocketClose(ws?: WebSocket): Promise<void> {
    const attachment = ws?.deserializeAttachment() as ViewerAttachment | null | undefined;
    if (attachment?.role === 'spectator') return;
    await super.webSocketClose();
    await this.recordTournamentResultIfNeeded();
    await this.broadcastSpectators();
  }

  override async webSocketError(ws?: WebSocket): Promise<void> {
    const attachment = ws?.deserializeAttachment() as ViewerAttachment | null | undefined;
    if (attachment?.role === 'spectator') return;
    await super.webSocketError();
    await this.recordTournamentResultIfNeeded();
    await this.broadcastSpectators();
  }

  override async alarm(): Promise<void> {
    await super.alarm();
    await this.recordTournamentResultIfNeeded();
    await this.broadcastSpectators();
  }
}
