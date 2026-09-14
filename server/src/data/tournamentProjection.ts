import { NotifyingTournamentRegistry } from '../notifications';
import type { EnginePairing, EngineRound, EngineStanding, EngineTournament, Participant } from '../tournamentEngineTypes';
import type { DataCommand, TournamentPairing, TournamentRegistration, TournamentRound, TournamentStanding } from './model';
import type { DataModelEnv } from './registry';
import { drainCanonicalOutbox, queueCanonicalProjection } from './outbox';

const TOURNAMENT_KEY='engine:tournament:v1:';
const TOURNAMENT_INDEX='engine:tournament-index:v1';
type TournamentProjectionEnv=DataModelEnv & Record<string,unknown>;

type StoredTournament=EngineTournament & { entryFeeCents?: number; currency?: string; money?: boolean; funding?: Record<string,unknown> };
function tournamentStatus(status:EngineTournament['status']): 'registration'|'running'|'completed'|'cancelled' {
  if(status==='completed') return 'completed'; if(status==='cancelled') return 'cancelled'; if(status==='registration'||status==='check_in') return 'registration'; return 'running';
}
function registrationStatus(p:Participant,t:EngineTournament):TournamentRegistration['status'] {
  if(p.status==='withdrawn') return 'withdrawn'; if(p.status==='eliminated') return 'eliminated'; if(t.status==='completed') return 'completed'; if(p.status==='active') return 'active'; if(p.checkedInAt!==null) return 'checked_in'; return 'registered';
}
function roundStatus(r:EngineRound):TournamentRound['status'] { return r.status==='pairing'?'pairing':r.status==='active'?'active':'complete'; }
function pairingStatus(p:EnginePairing):TournamentPairing['status'] { if(p.status==='live') return 'active'; if(p.status==='verified') return 'complete'; if(p.status==='bye') return 'bye'; if(p.status==='launch_error') return 'cancelled'; return 'pending'; }
function standingCommand(t:EngineTournament,s:EngineStanding):DataCommand|null {
  const p=t.participants[s.participantId]; if(!p) return null;
  const standing:TournamentStanding={tournamentId:t.id,userId:p.accountId,rank:s.rank,pointsHalf:Math.round(s.score*2),buchholzHalf:Math.round(s.buchholz*2),sonnebornBergerHalf:Math.round(s.sonnebornBerger*2),wins:s.wins,draws:s.draws,losses:s.losses,gamesPlayed:s.games,updatedAt:t.updatedAt};
  return {type:'upsert_tournament_standing',standing};
}
function commandsForTournament(t:StoredTournament):DataCommand[] {
  const commands:DataCommand[]=[{type:'upsert_tournament',tournament:{
    id:t.id,name:t.title,format:t.format,status:tournamentStatus(t.status),visibility:t.entryRules.mode==='invite'?'private':'public',rated:true,capacity:t.capacity,entryFeeCents:Number.isSafeInteger(t.entryFeeCents)?t.entryFeeCents:0,currency:t.currency ?? 'USD',startsAt:t.startTime,endsAt:t.completedAt,currentRound:t.currentRound,createdByUserId:t.organizerAccountId,
    rules:{entryRules:t.entryRules,checkInRules:t.checkInRules,timeControl:t.timeControl,positionPolicy:t.positionPolicy,payout:t.payout,roundCount:t.roundCount,tieBreakRules:t.tieBreakRules},createdAt:t.createdAt,updatedAt:t.updatedAt,
  }}];
  for(const p of Object.values(t.participants)) commands.push({type:'upsert_tournament_registration',registration:{id:`${t.id}:registration:${p.accountId}`,tournamentId:t.id,userId:p.accountId,status:registrationStatus(p,t),seed:p.seed,registeredAt:p.registeredAt,checkedInAt:p.checkedInAt,withdrawnAt:p.status==='withdrawn'?t.updatedAt:null,metadata:{participantId:p.id,rating:p.rating,ratingClass:p.ratingClass,eliminatedRound:p.eliminatedRound}}});
  for(const r of t.rounds) {
    const roundId=`${t.id}:round:${r.number}`;
    commands.push({type:'upsert_tournament_round',round:{id:roundId,tournamentId:t.id,roundNumber:r.number,status:roundStatus(r),startsAt:r.startedAt,endsAt:r.completedAt,lockedAt:r.status==='complete'?r.completedAt:null,createdAt:r.startedAt,updatedAt:r.completedAt ?? t.updatedAt}});
    for(const p of r.pairings) {
      const white=t.participants[p.whiteId]; const black=p.blackId?t.participants[p.blackId]:null;
      commands.push({type:'upsert_tournament_pairing',pairing:{id:p.id,tournamentId:t.id,roundId,boardNumber:p.board,whiteUserId:white?.accountId ?? null,blackUserId:black?.accountId ?? null,gameId:null,status:pairingStatus(p),result:p.result,createdAt:p.launchedAt ?? r.startedAt,updatedAt:p.completedAt ?? t.updatedAt}});
    }
  }
  for(const s of t.finalStandings ?? []) { const command=standingCommand(t,s); if(command) commands.push(command); }
  return commands;
}

export class CanonicalTournamentRegistry extends NotifyingTournamentRegistry {
  private canonicalInternals(): {ctx:DurableObjectState;env:TournamentProjectionEnv}{ return this as unknown as {ctx:DurableObjectState;env:TournamentProjectionEnv}; }
  private async project(id:string):Promise<void>{
    const {ctx,env}=this.canonicalInternals(); const tournament=await ctx.storage.get<StoredTournament>(`${TOURNAMENT_KEY}${id}`); if(!tournament)return;
    await queueCanonicalProjection(ctx.storage,env,commandsForTournament(tournament),`tournament:${id}:${tournament.updatedAt}`);
  }
  private async idFrom(request:Request):Promise<string>{
    const url=new URL(request.url); let id=url.searchParams.get('id') ?? url.searchParams.get('tournamentId') ?? '';
    if(!id&&request.method==='POST'){ const body=await request.clone().json().catch(()=>({})) as Record<string,unknown>; id=String(body.id ?? body.tournamentId ?? ''); }
    const match=/event_[a-f0-9]{32}/.exec(url.pathname); return (id||match?.[0]||'').slice(0,80);
  }
  override async fetch(request:Request):Promise<Response>{
    const {ctx,env}=this.canonicalInternals(); await drainCanonicalOutbox(ctx.storage,env).catch(()=>undefined); const id=await this.idFrom(request);
    const response=await super.fetch(request); if(response.ok&&id) await this.project(id).catch(()=>undefined); return response;
  }
  override async alarm():Promise<void>{
    await super.alarm(); const {ctx,env}=this.canonicalInternals(); await drainCanonicalOutbox(ctx.storage,env).catch(()=>undefined);
    const ids=(await ctx.storage.get<string[]>(TOURNAMENT_INDEX)) ?? []; for(const id of ids) await this.project(id).catch(()=>undefined);
  }
}
