import { WebPushNotificationRegistry } from '../webPush';
import type { InAppNotification } from '../notifications';
import type { DataCommand } from './model';
import type { DataModelEnv } from './registry';
import { drainCanonicalOutbox, queueCanonicalProjection } from './outbox';

type NotificationProjectionEnv=DataModelEnv & Record<string,unknown>;
const INDEX_PREFIX='notifications:index:v1:';
const ITEM_PREFIX='notifications:item:v1:';
function command(item:InAppNotification):DataCommand{return {type:'notification',notification:{id:item.id,userId:item.accountId,notificationType:item.kind,title:item.title,body:item.body,data:{action:item.action,priority:item.priority,metadata:item.metadata},dedupeKey:item.dedupeKey,createdAt:item.createdAt,readAt:item.readAt,deliveredAt:item.createdAt}};}

export class CanonicalNotificationRegistry extends WebPushNotificationRegistry {
  private canonicalInternals():{ctx:DurableObjectState;env:NotificationProjectionEnv}{return this as unknown as {ctx:DurableObjectState;env:NotificationProjectionEnv};}
  private async queue(items:InAppNotification[],key:string):Promise<void>{const {ctx,env}=this.canonicalInternals();if(items.length)await queueCanonicalProjection(ctx.storage,env,items.map(command),key);}
  private async accountItems(accountId:string):Promise<InAppNotification[]>{
    const {ctx}=this.canonicalInternals();const ids=(await ctx.storage.get<string[]>(`${INDEX_PREFIX}${accountId}`)) ?? [];const items:InAppNotification[]=[];
    for(const id of ids){const item=await ctx.storage.get<InAppNotification>(`${ITEM_PREFIX}${id}`);if(item)items.push(item);}return items;
  }
  override async fetch(request:Request):Promise<Response>{
    const {ctx,env}=this.canonicalInternals();await drainCanonicalOutbox(ctx.storage,env).catch(()=>undefined);const url=new URL(request.url);const body=request.method==='POST'?await request.clone().json().catch(()=>({})) as Record<string,any>:{};
    const response=await super.fetch(request);if(!response.ok)return response;
    if(url.pathname==='/internal/emit') { const payload=await response.clone().json().catch(()=>({})) as {notification?:InAppNotification};if(payload.notification)await this.queue([payload.notification],`notification:${payload.notification.id}:${payload.notification.readAt ?? 0}`).catch(()=>undefined); }
    if(url.pathname==='/internal/read') { const payload=await response.clone().json().catch(()=>({})) as {notification?:InAppNotification};if(payload.notification)await this.queue([payload.notification],`notification-read:${payload.notification.id}:${payload.notification.readAt ?? 0}`).catch(()=>undefined); }
    if(url.pathname==='/internal/read-all'&&body.accountId){const items=await this.accountItems(String(body.accountId));await this.queue(items,`notification-read-all:${body.accountId}:${Date.now()}`).catch(()=>undefined);}
    return response;
  }
}
