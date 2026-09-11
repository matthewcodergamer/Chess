import { reduceGameSession } from '../../shared/gameSession';
import { chessPositionKeyFromFen } from '../../shared/chess960Rules';
import { chess960Fen } from './chess960';
import { SpectatorChessRoom } from './spectatorRoom';
import type { TournamentEngineEnv } from './tournamentEngineApi';
import { ENGINE_ID_PATTERN } from './tournamentEngineTypes';

type Color = 'white' | 'black';
type EngineControl = { directStart: boolean };
type InternalRoom = {
  session: any;
  lastActivityAt: number;
  positionHistory: string[];
  players: { white: { token: string }; black: { token: string } | null };
};
type SpectatorMetadata = {
  tournamentId: string | null;
  ratingByToken: Record<string, number | null>;
  resultRecordedAt: number | null;
};

const CONTROL_KEY = 'engine:room-control:v1';
const SPECTATOR_METADATA_KEY = 'spectator:view-metadata:v1';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export class TournamentChessRoom extends SpectatorChessRoom {
  private roomInternals(): {
    room: InternalRoom | null;
    ctx: DurableObjectState;
    persist: () => Promise<void>;
    scheduleForState: () => Promise<void>;
    broadcast: () => void;
    connectedColors: () => Set<Color>;
  } {
    return this as unknown as {
      room: InternalRoom | null;
      ctx: DurableObjectState;
      persist: () => Promise<void>;
      scheduleForState: () => Promise<void>;
      broadcast: () => void;
      connectedColors: () => Set<Color>;
    };
  }

  private async control(): Promise<EngineControl> {
    return (await this.roomInternals().ctx.storage.get<EngineControl>(CONTROL_KEY)) ?? { directStart: false };
  }

  private async activateIfReady(): Promise<void> {
    const internal = this.roomInternals();
    const room = internal.room;
    if (!room || room.session.state !== 'READY' || !(await this.control()).directStart) return;
    const connected = internal.connectedColors();
    if (!connected.has('white') || !connected.has('black')) return;
    const now = Date.now();
    room.session = reduceGameSession(room.session, { type: 'TRANSITION', to: 'COUNTDOWN', at: now });
    room.session = reduceGameSession(room.session, { type: 'SET_COUNTDOWN', remainingMs: 0, endsAt: null, at: now });
    room.session = reduceGameSession(room.session, { type: 'TRANSITION', to: 'ACTIVE', at: now });
    room.session.clocks.startedAt = now;
    room.lastActivityAt = now;
    await internal.persist();
    await internal.scheduleForState();
    internal.broadcast();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const internal = this.roomInternals();

    if (url.hostname === 'room.internal' && url.pathname === '/engine-tournament-link' && request.method === 'POST') {
      if (!internal.room?.players.black) return json({ error: 'Tournament room is not ready to link.' }, 409);
      const body = await request.json().catch(() => ({})) as { tournamentId?: string; ratingsByToken?: Record<string, unknown> };
      const tournamentId = String(body.tournamentId ?? '').trim();
      if (!ENGINE_ID_PATTERN.test(tournamentId)) return json({ error: 'Invalid tournament id.' }, 400);
      const ratingByToken: Record<string, number | null> = {};
      for (const token of [internal.room.players.white.token, internal.room.players.black.token]) {
        const value = Number(body.ratingsByToken?.[token]);
        ratingByToken[token] = Number.isFinite(value) ? Math.round(value) : null;
      }
      const metadata: SpectatorMetadata = { tournamentId, ratingByToken, resultRecordedAt: null };
      await internal.ctx.storage.put(SPECTATOR_METADATA_KEY, metadata);
      return json({ ok: true });
    }

    const internalCreate = url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST';
    const internalJoin = url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST';
    const body = internalCreate || internalJoin
      ? await request.clone().json().catch(() => ({})) as { positionId?: unknown; tournamentDirectStart?: unknown }
      : null;
    const upgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    const response = await super.fetch(request);

    if (internalCreate && response.ok && body?.tournamentDirectStart === true && internal.room) {
      const positionId = Number(body.positionId);
      if (Number.isInteger(positionId) && positionId >= 0 && positionId <= 959) {
        const fen = chess960Fen(positionId);
        internal.room.session.positionId = positionId;
        internal.room.session.fen = fen;
        internal.room.positionHistory = [chessPositionKeyFromFen(fen)];
      }
      await internal.ctx.storage.put(CONTROL_KEY, { directStart: true } satisfies EngineControl);
      await internal.persist();
    }

    if (internalJoin && response.ok && body?.tournamentDirectStart === true && internal.room) {
      internal.room.session.state = 'READY';
      internal.room.session.countdownMs = 0;
      internal.room.session.countdownEndsAt = null;
      internal.room.session.clocks.startedAt = null;
      internal.room.lastActivityAt = Date.now();
      await internal.ctx.storage.put(CONTROL_KEY, { directStart: true } satisfies EngineControl);
      await internal.persist();
      await internal.scheduleForState();
      internal.broadcast();
    }

    if (upgrade) await this.activateIfReady();
    return response;
  }
}

export type TournamentRoomEnv = TournamentEngineEnv;
