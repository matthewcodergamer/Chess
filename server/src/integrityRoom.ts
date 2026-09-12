import { MoneyChessRoom, type MoneySettlementGuardContext, type MoneySettlementGuardResult } from './moneyRoom';
import { submitIntegrityGame, type IntegrityConnectionSignal, type IntegrityEnv, type IntegrityGameEvidence, type IntegrityMoveEvidence } from './integrityReview';

type Color = 'white' | 'black';
type Player = { name: string; token: string; accountId: string | null };
type MoveTiming = {
  moveNumber: number;
  clientSequence: number | null;
  clientSentAt: number | null;
  serverReceivedAt: number;
  serverCommittedAt: number;
  chargedElapsedMs: number;
  latencyCreditMs: number;
};
type InternalRoom = {
  code: string;
  createdAt: number;
  lastMoveTiming: MoveTiming | null;
  session: {
    state: string;
    fen: string;
    check: boolean;
    movesSan: string[];
    moveNumber: number;
    result: string | null;
    resultKind: string | null;
    winner: Color | null;
    finalizedAt: number | null;
    updatedAt: number;
  };
  players: { white: Player; black: Player | null };
};
type TournamentMetadata = { tournamentId: string | null };
type MoneyControl = { stakeCents: number; status: string };
type SocketAttachment = { token: string };
type PendingMove = {
  token: string;
  color: Color;
  uci: string;
  clientSequence: number | null;
  clientSentAt: number | null;
  beforeFen: string;
  beforeCheck: boolean;
  beforeMoveNumber: number;
};

type IntegrityRoomEnv = IntegrityEnv & Record<string, unknown>;

const MOVE_KEY = 'integrity:room-moves:v1';
const CONNECTION_KEY = 'integrity:room-connections:v1';
const REPORT_KEY = 'integrity:room-report:v1';
const TOURNAMENT_METADATA_KEY = 'spectator:view-metadata:v1';
const MONEY_CONTROL_KEY = 'money-match:v1';

function colorForToken(room: InternalRoom, token: string): Color | null {
  if (room.players.white.token === token) return 'white';
  if (room.players.black?.token === token) return 'black';
  return null;
}

function playerForColor(room: InternalRoom, color: Color): Player | null {
  return color === 'white' ? room.players.white : room.players.black;
}

function networkPrefix(value: string): string | null {
  const ip = value.trim();
  if (!ip) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    if (parts.some(part => Number(part) < 0 || Number(part) > 255)) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (ip.includes(':')) {
    const parts = ip.toLowerCase().split(':').filter(Boolean);
    return parts.length ? `${parts.slice(0, 4).join(':')}::/56` : null;
  }
  return null;
}

async function hmacSignal(secret: string, label: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${label}:${value}`)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function complexityFromFen(fen: string, inCheck: boolean): IntegrityMoveEvidence['complexity'] {
  const board = fen.split(' ')[0] ?? '';
  let pieceCount = 0;
  let pawnCount = 0;
  let whiteMaterial = 0;
  let blackMaterial = 0;
  const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  for (const char of board) {
    if (!/[prnbqk]/i.test(char)) continue;
    pieceCount += 1;
    if (char.toLowerCase() === 'p') pawnCount += 1;
    const points = value[char.toLowerCase()] ?? 0;
    if (char === char.toUpperCase()) whiteMaterial += points;
    else blackMaterial += points;
  }
  return {
    pieceCount,
    pawnCount,
    nonPawnPieceCount: Math.max(0, pieceCount - pawnCount),
    materialImbalance: Math.abs(whiteMaterial - blackMaterial),
    inCheck,
  };
}

export class IntegrityChessRoom extends MoneyChessRoom {
  private pendingMove: PendingMove | null = null;

  private integrityInternals(): { room: InternalRoom | null; ctx: DurableObjectState; env: IntegrityRoomEnv } {
    return this as unknown as { room: InternalRoom | null; ctx: DurableObjectState; env: IntegrityRoomEnv };
  }

  private signalCaptureEnabled(): boolean {
    const env = this.integrityInternals().env;
    return env.INTEGRITY_SIGNAL_CAPTURE === 'enabled' && typeof env.INTEGRITY_SIGNAL_SECRET === 'string' && env.INTEGRITY_SIGNAL_SECRET.length >= 24;
  }

  private async recordConnection(request: Request): Promise<void> {
    if (!this.signalCaptureEnabled()) return;
    const internal = this.integrityInternals();
    const room = internal.room;
    if (!room) return;
    const token = new URL(request.url).searchParams.get('token') ?? '';
    const color = colorForToken(room, token);
    if (!color) return;
    const player = playerForColor(room, color);
    const secret = String(internal.env.INTEGRITY_SIGNAL_SECRET);
    const userAgent = request.headers.get('user-agent') ?? '';
    const language = request.headers.get('accept-language') ?? '';
    const clientHints = [request.headers.get('sec-ch-ua') ?? '', request.headers.get('sec-ch-ua-platform') ?? '', request.headers.get('sec-ch-ua-mobile') ?? ''].join('|');
    const prefix = networkPrefix(request.headers.get('cf-connecting-ip') ?? '');
    const cf = (request as Request & { cf?: { country?: string; regionCode?: string } }).cf;
    const signal: IntegrityConnectionSignal = {
      accountId: player?.accountId ?? null,
      color,
      connectedAt: Date.now(),
      deviceSignalHash: userAgent ? await hmacSignal(secret, 'device', `${userAgent}|${language}|${clientHints}`) : null,
      networkSignalHash: prefix ? await hmacSignal(secret, 'network', prefix) : null,
      countryCode: typeof cf?.country === 'string' ? cf.country.slice(0, 2).toUpperCase() : null,
      regionCode: typeof cf?.regionCode === 'string' ? cf.regionCode.slice(0, 8).toUpperCase() : null,
    };
    const current = (await internal.ctx.storage.get<IntegrityConnectionSignal[]>(CONNECTION_KEY)) ?? [];
    const duplicate = current.some(item => item.accountId === signal.accountId && item.color === signal.color && item.deviceSignalHash === signal.deviceSignalHash && item.networkSignalHash === signal.networkSignalHash);
    if (!duplicate) await internal.ctx.storage.put(CONNECTION_KEY, [...current, signal].slice(-100));
  }

  private async capturePendingMove(): Promise<void> {
    const pending = this.pendingMove;
    const internal = this.integrityInternals();
    const room = internal.room;
    if (!pending || !room?.lastMoveTiming || room.session.moveNumber <= pending.beforeMoveNumber) return;
    const timing = room.lastMoveTiming;
    const existing = (await internal.ctx.storage.get<IntegrityMoveEvidence[]>(MOVE_KEY)) ?? [];
    if (existing.some(move => move.ply === room.session.moveNumber)) return;
    const move: IntegrityMoveEvidence = {
      ply: room.session.moveNumber,
      color: pending.color,
      uci: pending.uci,
      san: room.session.movesSan.at(-1) ?? '',
      fenBefore: pending.beforeFen,
      fenAfter: room.session.fen,
      clientSequence: timing.clientSequence ?? pending.clientSequence,
      clientSentAt: timing.clientSentAt ?? pending.clientSentAt,
      serverReceivedAt: timing.serverReceivedAt,
      serverCommittedAt: timing.serverCommittedAt,
      thinkTimeMs: Math.max(0, timing.chargedElapsedMs),
      chargedElapsedMs: Math.max(0, timing.chargedElapsedMs),
      latencyCreditMs: Math.max(0, timing.latencyCreditMs),
      clientToServerMs: timing.clientSentAt === null ? null : timing.serverReceivedAt - timing.clientSentAt,
      complexity: complexityFromFen(pending.beforeFen, pending.beforeCheck),
    };
    await internal.ctx.storage.put(MOVE_KEY, [...existing, move].slice(-500));
  }

  private async finalEvidence(): Promise<IntegrityGameEvidence | null> {
    const internal = this.integrityInternals();
    const room = internal.room;
    if (!room?.session.result || !room.players.black) return null;
    const tournament = (await internal.ctx.storage.get<TournamentMetadata>(TOURNAMENT_METADATA_KEY)) ?? null;
    const money = (await internal.ctx.storage.get<MoneyControl>(MONEY_CONTROL_KEY)) ?? null;
    const moves = (await internal.ctx.storage.get<IntegrityMoveEvidence[]>(MOVE_KEY)) ?? [];
    const connections = (await internal.ctx.storage.get<IntegrityConnectionSignal[]>(CONNECTION_KEY)) ?? [];
    const winner = room.session.winner ? playerForColor(room, room.session.winner) : null;
    return {
      schema: 'qqurz-integrity-game-v1',
      gameId: `room:${room.code}:${room.createdAt}`,
      roomCode: room.code,
      tournamentId: tournament?.tournamentId ?? null,
      money: Boolean(money?.stakeCents),
      stakeCents: money?.stakeCents ?? 0,
      createdAt: room.createdAt,
      finalizedAt: room.session.finalizedAt ?? room.session.updatedAt ?? Date.now(),
      result: room.session.result,
      resultKind: room.session.resultKind,
      winnerAccountId: winner?.accountId ?? null,
      players: [
        { accountId: room.players.white.accountId, name: room.players.white.name, color: 'white' },
        { accountId: room.players.black.accountId, name: room.players.black.name, color: 'black' },
      ],
      moves,
      connections,
    };
  }

  private async reportFinalEvidence(): Promise<{ disposition: 'allow' | 'manual_review'; reason: string | null }> {
    await this.capturePendingMove();
    const evidence = await this.finalEvidence();
    if (!evidence) return { disposition: 'allow', reason: null };
    const result = await submitIntegrityGame(this.integrityInternals().env, evidence);
    await this.integrityInternals().ctx.storage.put(REPORT_KEY, { at: Date.now(), disposition: result.disposition, reviewCaseId: result.reviewCaseId, reason: result.reason });
    return { disposition: result.disposition, reason: result.reason };
  }

  protected override async beforeMoneySettlement(_context: MoneySettlementGuardContext): Promise<MoneySettlementGuardResult> {
    const result = await this.reportFinalEvidence();
    if (result.disposition === 'manual_review') return { allowed: false, reason: result.reason ?? 'Funded settlement is awaiting integrity review.' };
    return { allowed: true };
  }

  override async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    const response = await super.fetch(request);
    if (upgrade && response.status === 101) await this.recordConnection(request);
    return response;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const internal = this.integrityInternals();
    const room = internal.room;
    this.pendingMove = null;
    if (room) {
      try {
        const payload = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as Record<string, unknown>;
        if (payload.type === 'move') {
          const token = (ws.deserializeAttachment() as SocketAttachment | null)?.token ?? '';
          const color = colorForToken(room, token);
          if (color) {
            this.pendingMove = {
              token,
              color,
              uci: String(payload.uci ?? '').trim().toLowerCase(),
              clientSequence: Number.isInteger(payload.clientSequence) ? Number(payload.clientSequence) : null,
              clientSentAt: Number.isFinite(payload.clientSentAt) ? Number(payload.clientSentAt) : null,
              beforeFen: room.session.fen,
              beforeCheck: Boolean(room.session.check),
              beforeMoveNumber: room.session.moveNumber,
            };
          }
        }
      } catch { /* base room owns command parsing/errors */ }
    }
    await super.webSocketMessage(ws, message);
    await this.capturePendingMove();
    this.pendingMove = null;
    if (this.integrityInternals().room?.session.result) await this.reportFinalEvidence();
  }

  override async alarm(): Promise<void> {
    await super.alarm();
    if (this.integrityInternals().room?.session.result) await this.reportFinalEvidence();
  }
}
