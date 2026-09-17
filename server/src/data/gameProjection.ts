import { NotifyingChessRoom } from '../notifications';
import { chess960Fen } from '../chess960';
import type { GameSessionModel } from '../../../shared/gameSession';
import type { CanonicalGame } from './model';
import type { DataModelEnv } from './registry';
import { drainCanonicalOutbox, queueCanonicalProjection } from './outbox';

type Seat = { name: string; token: string; accountId: string | null };
type MoveTiming = { moveNumber: number; clientSequence: number | null; clientSentAt: number | null; serverReceivedAt: number; serverCommittedAt: number; chargedElapsedMs: number; latencyCreditMs: number; nextClockStartedAt: number | null };
type RoomSnapshot = { code: string; session: GameSessionModel; lastMoveTiming: MoveTiming | null; createdAt: number; lastActivityAt: number; players: { white: Seat; black: Seat | null } };
type GameProjectionEnv = DataModelEnv & Record<string, unknown>;

type ClockInternals = {
  room: RoomSnapshot | null;
  persist: () => Promise<void>;
  scheduleForState: () => Promise<void>;
  broadcast: () => void;
};

function terminal(state: string): boolean { return ['CHECKMATE','DRAW','RESIGN','TIMEOUT','FINAL'].includes(state); }
function status(session: GameSessionModel): CanonicalGame['status'] { if(terminal(session.state)) return 'completed'; if(session.state==='PAUSED'||session.state==='RECONNECTING') return 'paused'; if(session.state==='ACTIVE') return 'active'; return 'created'; }
function initialFen(session: GameSessionModel): string | null { return Number.isInteger(session.positionId) ? chess960Fen(session.positionId!) : null; }
function gameId(room: RoomSnapshot): string { return `room:${room.code}:${room.createdAt}`; }
function roomGame(room: RoomSnapshot, latestMove?: { uci: string; moverColor: 'white'|'black'; clientSentAt: number|null; timing: MoveTiming }): CanonicalGame {
  const session=room.session; const ended=terminal(session.state) ? session.finalizedAt ?? session.updatedAt : null;
  const started=latestMove?.timing.moveNumber===1 ? latestMove.timing.serverReceivedAt : null;
  const participants:CanonicalGame['participants']=[{id:`${gameId(room)}:white`,userId:room.players.white.accountId,seatNo:1,color:'white',displayName:room.players.white.name,joinedAt:room.createdAt}];
  if(room.players.black) participants.push({id:`${gameId(room)}:black`,userId:room.players.black.accountId,seatNo:2,color:'black',displayName:room.players.black.name,joinedAt:room.createdAt});
  const moves:CanonicalGame['moves']=latestMove ? [{
    ply:latestMove.timing.moveNumber,moverUserId:latestMove.moverColor==='white'?room.players.white.accountId:room.players.black?.accountId ?? null,moverColor:latestMove.moverColor,uci:latestMove.uci,
    san:session.movesSan[latestMove.timing.moveNumber-1] ?? '',fenAfter:session.fen,clientSentAt:latestMove.clientSentAt,serverReceivedAt:latestMove.timing.serverReceivedAt,committedAt:latestMove.timing.serverCommittedAt,
    thinkMs:latestMove.timing.chargedElapsedMs,clockAfterMs:latestMove.moverColor==='white'?session.clocks.whiteMs:session.clocks.blackMs,createdAt:latestMove.timing.serverCommittedAt,
  }] : [];
  return {
    id:gameId(room),roomCode:room.code,status:status(session),resultKind:session.resultKind,resultText:session.result,winnerUserId:session.winner==='white'?room.players.white.accountId:session.winner==='black'?room.players.black?.accountId ?? null:null,
    positionId:session.positionId,initialFen:initialFen(session),finalFen:session.fen,baseMs:session.clocks.baseMs,incrementMs:session.clocks.incrementMs,rated:Boolean(room.players.white.accountId&&room.players.black?.accountId&&room.players.white.accountId!==room.players.black.accountId),
    createdAt:room.createdAt,startedAt:started,endedAt:ended,participants,moves,metadata:{source:'authoritative-room',moveCount:session.moveNumber,state:session.state},
  };
}

export class CanonicalChessRoom extends NotifyingChessRoom {
  private canonicalInternals(): { ctx: DurableObjectState; env: GameProjectionEnv; room: RoomSnapshot | null } { return this as unknown as { ctx: DurableObjectState; env: GameProjectionEnv; room: RoomSnapshot | null }; }
  private clockInternals(): ClockInternals { return this as unknown as ClockInternals; }

  private autoTransferClock(): void {
    const room = this.clockInternals().room;
    const pending = room?.session.pendingClockPress;
    if (!pending) return;
    const key = pending === 'white' ? 'whiteMs' : 'blackMs';
    room.session.clocks[key] += room.session.clocks.incrementMs;
    room.session.pendingClockPress = null;
    room.session.clocks.startedAt = Date.now();
  }

  private async project(room: RoomSnapshot | null, latestMove?: { uci: string; moverColor:'white'|'black'; clientSentAt:number|null; timing:MoveTiming }): Promise<void> {
    if(!room) return; const {ctx,env}=this.canonicalInternals();
    await queueCanonicalProjection(ctx.storage,env,[{type:'record_game',game:roomGame(room,latestMove)}],`room:${room.code}:${crypto.randomUUID()}`);
  }
  override async fetch(request: Request): Promise<Response> {
    const {ctx,env}=this.canonicalInternals(); await drainCanonicalOutbox(ctx.storage,env).catch(()=>undefined);
    const response=await super.fetch(request); if(response.ok) await this.project(this.canonicalInternals().room).catch(()=>undefined); return response;
  }
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const before=this.canonicalInternals().room; const beforeMove=before?.session.moveNumber ?? 0; const beforeColor=before?.session.sideToMove ?? 'white';
    let payload:Record<string,any>|null=null; try { payload=JSON.parse(typeof message==='string'?message:new TextDecoder().decode(message)); } catch { /* base class handles malformed input */ }

    // Migrate any room that still has the old physical-clock handshake. New
    // moves never leave the session waiting for a manual press.
    if (payload?.type === 'move') this.autoTransferClock();

    await super.webSocketMessage(ws,message);
    const room=this.canonicalInternals().room; const timing=room?.lastMoveTiming ?? null;
    const accepted=payload !== null && payload.type==='move'&&room&&timing&&room.session.moveNumber===beforeMove+1&&timing.moveNumber===room.session.moveNumber;
    const movePayload = accepted ? payload : null;
    if (accepted) {
      // The legacy reducer records the mover as pending until CLOCK_TRANSFERRED.
      // Resolve that transfer immediately so the opponent clock starts without
      // any physical-clock UI or extra client command.
      this.autoTransferClock();
      const internals = this.clockInternals();
      await internals.persist();
      await internals.scheduleForState();
      internals.broadcast();
    }
    await this.project(room,movePayload&&timing?{uci:String(movePayload.uci ?? '').toLowerCase(),moverColor:beforeColor,clientSentAt:Number.isFinite(movePayload.clientSentAt)?Number(movePayload.clientSentAt):null,timing}:undefined).catch(()=>undefined);
  }
  override async alarm(): Promise<void> { await super.alarm(); await this.project(this.canonicalInternals().room).catch(()=>undefined); }
  override async webSocketClose(): Promise<void> { await super.webSocketClose(); await this.project(this.canonicalInternals().room).catch(()=>undefined); }
  override async webSocketError(): Promise<void> { await super.webSocketError(); await this.project(this.canonicalInternals().room).catch(()=>undefined); }
}
