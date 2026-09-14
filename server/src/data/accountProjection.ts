import { SocialAccountRegistry } from '../social';
import { chess960Fen } from '../chess960';
import type { CanonicalGame, CanonicalUser, DataCommand } from './model';
import type { DataModelEnv } from './registry';
import { drainCanonicalOutbox, queueCanonicalProjection } from './outbox';

type Rating = { rating?: number; deviation?: number; volatility?: number; games?: number; lastRatedAt?: number | null };
type StoredSession = { id: string; tokenHash: string; createdAt: number; lastSeenAt: number; expiresAt: number; userAgent?: string; ipPrefix?: string; deviceName?: string };
type StoredAccount = Record<string, any> & {
  id: string; email: string; emailVerifiedAt?: number | null; username: string; displayName: string; countryCode?: string; avatar?: string; avatarImage?: string | null;
  createdAt: number; updatedAt: number; passwordHash: string; passwordSalt: string; passwordIterations: number; privacy?: unknown; notifications?: unknown; settings?: { language?: string; timezone?: string };
  chess960Ratings?: { rapid?: Rating; blitz?: Rating; bullet?: Rating }; sessions?: Record<string, StoredSession>;
  followingPlayerIds?: string[]; friendPlayerIds?: string[]; incomingFriendRequestIds?: string[]; outgoingFriendRequestIds?: string[]; blockedPlayerIds?: string[]; gameHistory?: Array<Record<string, any>>;
};
type AccountProjectionEnv = DataModelEnv & Record<string, unknown>;
type InternalGameResult = {
  id: string; roomCode: string; playedAt?: number; positionId?: number | null; baseMs?: number; incrementMs?: number; moveCount?: number; result?: string; resultKind?: string | null; winner?: 'white'|'black'|null;
  white: { accountId?: string|null; name: string }; black: { accountId?: string|null; name: string };
};
type RatingPool = NonNullable<CanonicalUser['ratings']>[number]['pool'];

function safeIds(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))] : []; }
async function sha256(value: string): Promise<string> { const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''); }
function devicePlatform(ua=''): { platform: string; browser: string } {
  const platform = /iphone|ipad/i.test(ua) ? 'ios' : /android/i.test(ua) ? 'android' : /macintosh|mac os/i.test(ua) ? 'macos' : /windows/i.test(ua) ? 'windows' : /linux/i.test(ua) ? 'linux' : 'unknown';
  const browser = /crios|chrome/i.test(ua) ? 'chrome' : /firefox|fxios/i.test(ua) ? 'firefox' : /safari/i.test(ua) ? 'safari' : 'unknown';
  return { platform, browser };
}
function ratingPool(key: 'rapid'|'blitz'|'bullet'): RatingPool { return `chess960_${key}` as RatingPool; }
function canonicalUser(account: StoredAccount, deletedAt: number | null = null): CanonicalUser {
  const deleted = deletedAt !== null;
  const ratings = (['rapid','blitz','bullet'] as const).map(key => {
    const rating=account.chess960Ratings?.[key] ?? {};
    return { pool: ratingPool(key), rating:Number(rating.rating ?? 1500), deviation:Number(rating.deviation ?? 350), volatility:Number(rating.volatility ?? .06), ratedGames:Number(rating.games ?? 0), lastRatedAt:rating.lastRatedAt ?? null };
  });
  return {
    id: account.id,
    email: deleted ? `deleted-${account.id}@deleted.invalid` : account.email,
    status: deleted ? 'deleted' : 'active', emailVerifiedAt: deleted ? null : account.emailVerifiedAt ?? null,
    createdAt: account.createdAt, updatedAt: deletedAt ?? account.updatedAt, deletedAt,
    profile: {
      username: deleted ? `deleted_${account.id.replaceAll('-','').slice(0,18)}` : account.username,
      displayName: deleted ? 'Deleted player' : account.displayName,
      countryCode: deleted ? '' : account.countryCode ?? '', avatar: deleted ? '♞' : account.avatar ?? '♞', avatarImage: deleted ? null : account.avatarImage ?? null,
      language: account.settings?.language ?? 'en', timezone: account.settings?.timezone ?? 'auto', privacy: deleted ? { profileVisibility:'private', showCountry:false, showHistory:false, allowChallenges:false } : account.privacy,
      notificationSettings: deleted ? {} : account.notifications,
    },
    passwordIdentity: deleted ? undefined : { providerSubject: account.id, credentialHash: account.passwordHash, credentialSalt: account.passwordSalt, credentialIterations: account.passwordIterations },
    ratings,
  };
}
function syncAccountCommands(account: StoredAccount): DataCommand[] {
  const commands: DataCommand[] = [{ type:'sync_user', user:canonicalUser(account) }];
  for (const session of Object.values(account.sessions ?? {})) {
    const deviceId=`device:${session.id}`; const info=devicePlatform(session.userAgent);
    commands.push({ type:'device', device:{ id:deviceId,userId:account.id,deviceName:session.deviceName ?? 'Browser session',platform:info.platform,browser:info.browser,firstSeenAt:session.createdAt,lastSeenAt:session.lastSeenAt } });
    commands.push({ type:'upsert_session', session:{ id:session.id,userId:account.id,tokenHash:session.tokenHash,deviceRecordId:deviceId,userAgent:session.userAgent ?? '',ipPrefix:session.ipPrefix ?? '',createdAt:session.createdAt,lastSeenAt:session.lastSeenAt,expiresAt:session.expiresAt } });
  }
  return commands;
}
function outcome(winner:'white'|'black'|null,color:'white'|'black'):'win'|'loss'|'draw' { return winner===null?'draw':winner===color?'win':'loss'; }
function poolFromHistory(item: Record<string, any> | undefined): string | null { const value=item?.ratingClass; return value==='rapid'||value==='blitz'||value==='bullet'?`chess960_${value}`:null; }

export class CanonicalAccountRegistry extends SocialAccountRegistry {
  private canonicalInternals(): { ctx: DurableObjectState; env: AccountProjectionEnv } { return this as unknown as { ctx: DurableObjectState; env: AccountProjectionEnv }; }
  private async storedAccount(id: string | null | undefined): Promise<StoredAccount | null> { return id ? (await this.canonicalInternals().ctx.storage.get<StoredAccount>(`account:${id}`)) ?? null : null; }
  private async authAccountId(request: Request): Promise<string | null> {
    const match=/^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? ''); if(!match) return null;
    const lookup=await this.canonicalInternals().ctx.storage.get<{accountId:string}>(`session:${await sha256(match[1].trim())}`); return lookup?.accountId ?? null;
  }
  private async queue(commands: DataCommand[], key?: string): Promise<void> { if(commands.length) await queueCanonicalProjection(this.canonicalInternals().ctx.storage,this.canonicalInternals().env,commands,key); }
  private async syncByIds(ids: Array<string|null|undefined>): Promise<DataCommand[]> { const commands:DataCommand[]=[]; for(const id of [...new Set(ids.filter((v):v is string=>Boolean(v)))]) { const account=await this.storedAccount(id); if(account) commands.push(...syncAccountCommands(account)); } return commands; }
  private historyFor(account: StoredAccount|null, gameId:string): Record<string,any>|undefined { return account?.gameHistory?.find(item=>item.id===gameId); }

  override async fetch(request: Request): Promise<Response> {
    const { ctx, env }=this.canonicalInternals();
    await drainCanonicalOutbox(ctx.storage,env).catch(()=>undefined);
    const clone=request.clone(); const url=new URL(request.url); const actorId=await this.authAccountId(request);
    const beforeActor=await this.storedAccount(url.searchParams.get('actorId') ?? actorId);
    const body = request.method==='GET'||request.method==='HEAD' ? null : await clone.json().catch(()=>null) as Record<string,any>|null;
    const deleting = url.pathname==='/account/delete' ? beforeActor : null;
    const response=await super.fetch(request);
    if(!response.ok) return response;
    const payload=await response.clone().json().catch(()=>({})) as Record<string,any>;
    const commands:DataCommand[]=[];

    if (deleting) {
      const now=Date.now(); commands.push({type:'sync_user',user:canonicalUser(deleting,now)});
      for(const session of Object.values(deleting.sessions ?? {})) commands.push({type:'revoke_session',sessionId:session.id,revokedAt:now,reason:'account_deleted'});
      commands.push({type:'audit',event:{eventId:`account-delete:${deleting.id}:${now}`,actorUserId:deleting.id,actorType:'user',action:'account.delete',entityType:'user',entityId:deleting.id,createdAt:now}});
    } else {
      const accountId=payload.account?.id ?? actorId ?? url.searchParams.get('actorId');
      commands.push(...await this.syncByIds([accountId]));
    }

    if (url.pathname==='/internal/game-result' && body?.id) {
      const game=body as unknown as InternalGameResult; const white=await this.storedAccount(game.white.accountId); const black=await this.storedAccount(game.black.accountId);
      commands.push(...await this.syncByIds([game.white.accountId,game.black.accountId]));
      const whiteHistory=this.historyFor(white,game.id); const blackHistory=this.historyFor(black,game.id); const playedAt=Number(game.playedAt)||Date.now();
      const record:CanonicalGame={
        id:game.id,roomCode:game.roomCode,status:'completed',resultKind:game.resultKind ?? null,resultText:game.result ?? null,winnerUserId:game.winner==='white'?game.white.accountId ?? null:game.winner==='black'?game.black.accountId ?? null:null,
        positionId:Number.isInteger(game.positionId)?game.positionId!:null,initialFen:Number.isInteger(game.positionId)?chess960Fen(game.positionId!):null,baseMs:Math.max(0,Number(game.baseMs)||0),incrementMs:Math.max(0,Number(game.incrementMs)||0),rated:Boolean(white&&black&&white.id!==black.id),ratingPool:poolFromHistory(whiteHistory) ?? poolFromHistory(blackHistory),createdAt:playedAt,endedAt:playedAt,
        participants:[
          {userId:game.white.accountId ?? null,seatNo:1,color:'white',displayName:game.white.name,outcome:outcome(game.winner ?? null,'white'),ratingPool:poolFromHistory(whiteHistory),ratingBefore:whiteHistory?.ratingBefore ?? null,ratingAfter:whiteHistory?.ratingAfter ?? null,ratingDeviationBefore:whiteHistory?.ratingDeviationBefore ?? null,ratingDeviationAfter:whiteHistory?.ratingDeviationAfter ?? null},
          {userId:game.black.accountId ?? null,seatNo:2,color:'black',displayName:game.black.name,outcome:outcome(game.winner ?? null,'black'),ratingPool:poolFromHistory(blackHistory),ratingBefore:blackHistory?.ratingBefore ?? null,ratingAfter:blackHistory?.ratingAfter ?? null,ratingDeviationBefore:blackHistory?.ratingDeviationBefore ?? null,ratingDeviationAfter:blackHistory?.ratingDeviationAfter ?? null},
        ], metadata:{ moveCount:Math.max(0,Number(game.moveCount)||0), source:'account-result' },
      };
      commands.push({type:'record_game',game:record});
    }

    if (url.pathname==='/account/block' || url.pathname==='/account/unblock') {
      const username=String(body?.username ?? '').toLowerCase(); const targetId=username ? await ctx.storage.get<string>(`username:${username}`) : null;
      if(actorId&&targetId) commands.push({type:'player_block',blockerUserId:actorId,blockedUserId:targetId,active:url.pathname==='/account/block',at:Date.now()});
    }

    if (url.pathname.startsWith('/internal/social/') && request.method==='POST') {
      const socialActorId=url.searchParams.get('actorId') ?? ''; const targetId=String(body?.accountId ?? payload.player?.id ?? ''); const now=Date.now();
      commands.push(...await this.syncByIds([socialActorId,targetId]));
      if(socialActorId&&targetId&&url.pathname==='/internal/social/follow') commands.push({type:'follow',followerUserId:socialActorId,followedUserId:targetId,active:body?.follow!==false,at:now});
      if(socialActorId&&targetId&&url.pathname==='/internal/social/friend/remove') commands.push({type:'friendship',userAId:socialActorId,userBId:targetId,active:false,at:now});
      if(socialActorId&&targetId&&url.pathname==='/internal/social/friend-request') {
        const accepted=payload.accepted===true; commands.push({type:'friend_invite',invite:{id:`friend:${socialActorId}:${targetId}`,fromUserId:socialActorId,toUserId:targetId,status:accepted?'accepted':'pending',createdAt:now,respondedAt:accepted?now:null}});
        if(accepted) commands.push({type:'friendship',userAId:socialActorId,userBId:targetId,active:true,at:now});
      }
      if(socialActorId&&targetId&&url.pathname==='/internal/social/friend-request/respond') {
        const accepted=body?.action==='accept'; commands.push({type:'friend_invite',invite:{id:`friend:${targetId}:${socialActorId}`,fromUserId:targetId,toUserId:socialActorId,status:accepted?'accepted':'declined',createdAt:now,respondedAt:now}});
        if(accepted) commands.push({type:'friendship',userAId:socialActorId,userBId:targetId,active:true,at:now});
      }
    }

    const securityRoutes:Record<string,string>={ '/account/register':'account.register','/account/login':'account.login','/account/password':'account.password_change','/account/verify-email':'account.email_verified','/account/sessions/revoke':'session.revoke','/account/sessions/revoke-others':'session.revoke_others','/account/reset-password':'account.password_reset' };
    const securityAction=securityRoutes[url.pathname]; const securityUserId=payload.account?.id ?? actorId;
    if(securityAction&&securityUserId) commands.push({type:'security_event',event:{id:`sec_${crypto.randomUUID().replaceAll('-','')}`,userId:securityUserId,eventType:securityAction,success:true,userAgent:request.headers.get('user-agent') ?? '',createdAt:Date.now()}});

    await this.queue(commands,`account:${crypto.randomUUID()}`);
    return response;
  }
}
