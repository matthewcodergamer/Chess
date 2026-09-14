import { FairPlayIntegrityRegistry } from '../fairPlay';
import type { DataCommand } from './model';
import type { DataModelEnv } from './registry';
import { drainCanonicalOutbox, queueCanonicalProjection } from './outbox';

type ModerationProjectionEnv=DataModelEnv & Record<string,unknown>;
type FairPlayReport={id:string;reporterAccountId:string;targetAccountId:string;gameId:string|null;tournamentId:string|null;money:boolean;reason:string;details:string;createdAt:number;status:'open'|'reviewed'|'dismissed'|'escalated';moderatorNotes:Array<{reviewerId:string;note:string;at:number}>};
type FairPlayCase={id:string;accountId:string;gameId:string|null;tournamentId:string|null;money:boolean;priority:'standard'|'medium'|'high';status:'queued'|'in_review'|'second_review'|'cleared'|'escalated'|'action_required';signals:Array<{code:string;detail:string}>;sourceReportIds:string[];reviewers:string[];notes:Array<{reviewerId:string;note:string;at:number}>;createdAt:number;updatedAt:number};
const REPORT_PREFIX='fair-play:report:v1:';const REPORT_INDEX='fair-play:report-index:v1';const CASE_PREFIX='fair-play:case:v1:';const CASE_INDEX='fair-play:case-index:v1';
function reportStatus(status:FairPlayReport['status']):'open'|'triaged'|'reviewing'|'resolved'|'dismissed'{if(status==='dismissed')return'dismissed';if(status==='reviewed')return'resolved';if(status==='escalated')return'reviewing';return'open';}
function caseAction(status:FairPlayCase['status']):string{return `fair_play_${status}`;}

export class CanonicalIntegrityReviewRegistry extends FairPlayIntegrityRegistry {
  private canonicalInternals():{ctx:DurableObjectState;env:ModerationProjectionEnv}{return this as unknown as {ctx:DurableObjectState;env:ModerationProjectionEnv};}
  private async projectRecent():Promise<void>{
    const {ctx,env}=this.canonicalInternals();const commands:DataCommand[]=[];
    const reportIds=(await ctx.storage.get<string[]>(REPORT_INDEX)) ?? [];
    for(const id of reportIds.slice(0,250)){const r=await ctx.storage.get<FairPlayReport>(`${REPORT_PREFIX}${id}`);if(!r)continue;commands.push({type:'moderation_report',report:{id:r.id,reporterUserId:r.reporterAccountId,targetUserId:r.targetAccountId,gameId:r.gameId,tournamentId:r.tournamentId,category:r.reason,narrative:r.details,status:reportStatus(r.status),priority:r.money?80:40,createdAt:r.createdAt,updatedAt:r.moderatorNotes.at(-1)?.at ?? r.createdAt,reviewedAt:r.status==='open'?null:r.moderatorNotes.at(-1)?.at ?? r.createdAt,reviewedByUserId:r.moderatorNotes.at(-1)?.reviewerId ?? null,metadata:{money:r.money,notes:r.moderatorNotes}}});}
    const caseIds=(await ctx.storage.get<string[]>(CASE_INDEX)) ?? [];
    for(const id of caseIds.slice(0,250)){const c=await ctx.storage.get<FairPlayCase>(`${CASE_PREFIX}${id}`);if(!c)continue;commands.push({type:'moderation_record',record:{id:`case:${c.id}`,userId:c.accountId,reportId:c.sourceReportIds[0] ?? null,action:caseAction(c.status),reason:c.signals.map(signal=>signal.code).join(',') || 'fair_play_review',startsAt:c.createdAt,endsAt:['cleared','escalated','action_required'].includes(c.status)?c.updatedAt:null,createdAt:c.createdAt,createdByUserId:c.reviewers.at(-1) ?? null,metadata:{gameId:c.gameId,tournamentId:c.tournamentId,money:c.money,priority:c.priority,signals:c.signals,sourceReportIds:c.sourceReportIds,reviewers:c.reviewers,notes:c.notes}}});}
    if(commands.length){commands.push({type:'audit',event:{eventId:`moderation-sync:${caseIds[0] ?? reportIds[0] ?? 'none'}:${Date.now()}`,actorType:'system',action:'moderation.project',entityType:'moderation_registry',entityId:'qqurz-integrity-review-registry-v1',metadata:{reports:Math.min(250,reportIds.length),cases:Math.min(250,caseIds.length)},createdAt:Date.now()}});await queueCanonicalProjection(ctx.storage,env,commands,`moderation:${caseIds[0] ?? 'none'}:${reportIds[0] ?? 'none'}`);}
  }
  override async fetch(request:Request):Promise<Response>{const {ctx,env}=this.canonicalInternals();await drainCanonicalOutbox(ctx.storage,env).catch(()=>undefined);const response=await super.fetch(request);if(response.ok&&request.method!=='GET')await this.projectRecent().catch(()=>undefined);return response;}
}
