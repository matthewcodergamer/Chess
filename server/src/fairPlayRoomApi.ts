import { resolveAccountSession, type AccountEnv } from './accounts';
import {
  FairPlayChessRoom,
  setCompetitiveBlock,
  submitFairPlayReport,
  type FairPlayReportReason,
} from './fairPlay';
import type { IntegrityEnv } from './integrityReview';

type Color = 'white' | 'black';
type RoomPlayer = { name: string; token: string; accountId: string | null };
type RoomInternals = {
  room: { code: string; createdAt: number; players: { white: RoomPlayer; black: RoomPlayer | null } } | null;
  ctx: DurableObjectState;
};
type Env = AccountEnv & IntegrityEnv & { ROOMS: DurableObjectNamespace<FairPlayActionChessRoom> };

const TOURNAMENT_METADATA_KEY = 'spectator:view-metadata:v1';
const MONEY_CONTROL_KEY = 'money-match:v1';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function clean(value: unknown, max = 800): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function validReason(value: unknown): value is FairPlayReportReason {
  return ['engine_assistance', 'stalling', 'abuse', 'sandbagging', 'multi_account', 'disconnect_abuse', 'other'].includes(String(value));
}
function otherPlayer(room: NonNullable<RoomInternals['room']>, accountId: string): RoomPlayer | null {
  if (room.players.white.accountId === accountId) return room.players.black;
  if (room.players.black?.accountId === accountId) return room.players.white;
  return null;
}

export class FairPlayActionChessRoom extends FairPlayChessRoom {
  private actionInternals(): RoomInternals { return this as unknown as RoomInternals; }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'room.internal' && url.pathname === '/fair-play-context' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as { accountId?: string };
      const accountId = clean(body.accountId, 80);
      const room = this.actionInternals().room;
      if (!room || !room.players.black || !accountId) return json({ error: 'Room context is unavailable.' }, 404);
      const target = otherPlayer(room, accountId);
      if (!target?.accountId) return json({ error: 'Both players must be signed in for this action.' }, 409);
      const tournament = (await this.actionInternals().ctx.storage.get<{ tournamentId?: string | null }>(TOURNAMENT_METADATA_KEY)) ?? null;
      const money = (await this.actionInternals().ctx.storage.get<{ stakeCents?: number }>(MONEY_CONTROL_KEY)) ?? null;
      return json({
        roomCode: room.code,
        gameId: `room:${room.code}:${room.createdAt}`,
        targetAccountId: target.accountId,
        targetName: target.name,
        tournamentId: tournament?.tournamentId ?? null,
        money: Boolean(money?.stakeCents),
      });
    }
    return super.fetch(request);
  }
}

async function roomContext(env: Env, roomCode: string, accountId: string): Promise<{ roomCode: string; gameId: string; targetAccountId: string; targetName: string; tournamentId: string | null; money: boolean } | null> {
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return null;
  const room = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
  const response = await room.fetch(new Request('https://room.internal/fair-play-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId }),
  }));
  if (!response.ok) return null;
  return response.json() as Promise<{ roomCode: string; gameId: string; targetAccountId: string; targetName: string; tournamentId: string | null; money: boolean }>;
}

export async function handleFairPlayRoomActionRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!['/fair-play/report-room', '/fair-play/block-room'].includes(url.pathname)) return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const identity = await resolveAccountSession(request, env);
  if (!identity) return json({ error: 'Sign in to use fair-play player actions.' }, 401);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const roomCode = clean(body.roomCode, 6).toUpperCase();
  const context = await roomContext(env, roomCode, identity.id);
  if (!context) return json({ error: 'Could not verify that you are a player in this room.' }, 403);

  if (url.pathname === '/fair-play/block-room') {
    const result = await setCompetitiveBlock(env, identity.id, context.targetAccountId, body.blocked !== false);
    return result.ok ? json({ ok: true, blocked: body.blocked !== false, targetName: context.targetName }) : json({ error: result.error }, 503);
  }

  if (!validReason(body.reason)) return json({ error: 'Choose a valid report reason.' }, 400);
  const result = await submitFairPlayReport(env, {
    reporterAccountId: identity.id,
    targetAccountId: context.targetAccountId,
    gameId: context.gameId,
    roomCode: context.roomCode,
    tournamentId: context.tournamentId,
    money: context.money,
    reason: body.reason,
    details: clean(body.details, 800),
  });
  return result.ok ? json({ ok: true, reportId: result.reportId, targetName: context.targetName }, 201) : json({ error: result.error }, 503);
}
