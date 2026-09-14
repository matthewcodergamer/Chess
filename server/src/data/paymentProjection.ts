import { NotifyingPaymentLedger } from '../notifications';
import type { LedgerTransaction, WalletSnapshot } from '../paymentLedger';
import type { ComplianceProfile } from '../paymentPolicy';
import type { CanonicalLedgerTransaction, DataCommand, LedgerEntryInput } from './model';
import type { DataModelEnv } from './registry';
import { drainCanonicalOutbox, queueCanonicalProjection } from './outbox';

type PaymentProjectionEnv=DataModelEnv & Record<string,unknown>;
type Entitlements={premium3d:boolean;updatedAt:number};
type PaymentApiEvent={
  kind:'payment_intent'; id:string; userId:string|null; provider:string; providerIntentId?:string|null; purpose:string; amountCents:number; currency?:string; status:'created'|'pending'|'requires_action'|'authorized'|'captured'|'failed'|'cancelled'|'refunded'|'partially_refunded'; idempotencyKey:string; createdAt:number; updatedAt:number; metadata?:Record<string,unknown>;
};
const CLEARING_WALLET='wallet:external:legacy-clearing:USD';

function walletId(accountId:string):string { return accountId==='platform:revenue'?'wallet:platform:revenue:USD':`wallet:user:${accountId}:USD`; }
function walletType(accountId:string):'user'|'platform_revenue' { return accountId==='platform:revenue'?'platform_revenue':'user'; }
function ledgerEntries(tx:LedgerTransaction):LedgerEntryInput[]{
  const entries:LedgerEntryInput[]=[]; const id=walletId(tx.accountId); const availableBucket=tx.accountId==='platform:revenue'?'revenue':'available';
  if(tx.availableDeltaCents) entries.push({walletAccountId:id,bucket:availableBucket,amountCents:tx.availableDeltaCents});
  if(tx.heldDeltaCents) entries.push({walletAccountId:id,bucket:'held',amountCents:tx.heldDeltaCents});
  if(tx.pendingWithdrawalDeltaCents) entries.push({walletAccountId:id,bucket:'pending_withdrawal',amountCents:tx.pendingWithdrawalDeltaCents});
  const sum=entries.reduce((total,row)=>total+row.amountCents,0); if(sum) entries.push({walletAccountId:CLEARING_WALLET,bucket:'external',amountCents:-sum});
  return entries;
}
function canonicalTransaction(tx:LedgerTransaction):CanonicalLedgerTransaction|null {
  const entries=ledgerEntries(tx); if(entries.length<2)return null;
  return {id:tx.id,transactionType:tx.type,purpose:tx.purpose,reference:tx.reference,idempotencyScope:`ledger:${tx.accountId}`,idempotencyKey:tx.idempotencyKey,provider:tx.provider,providerReference:tx.providerReference,status:'posted',sequence:tx.sequence,previousHash:tx.previousHash,hash:tx.hash,metadata:{...tx.metadata,legacyAccountId:tx.accountId,balanceAfter:tx.balanceAfter,feeCents:tx.feeCents},createdAt:tx.createdAt,entries};
}
function walletCommands(accountId:string,at:number):DataCommand[]{ return [
  {type:'wallet_account',wallet:{id:walletId(accountId),userId:accountId==='platform:revenue'?null:accountId,accountType:walletType(accountId),currency:'USD',status:'open',createdAt:at,updatedAt:at}},
  {type:'wallet_account',wallet:{id:CLEARING_WALLET,userId:null,accountType:'external_clearing',currency:'USD',status:'open',createdAt:at,updatedAt:at}},
]; }
function payoutCommand(tx:LedgerTransaction):DataCommand|null {
  if(!['withdrawal_requested','withdrawal_completed','withdrawal_reversed'].includes(tx.type)||tx.accountId==='platform:revenue')return null;
  const status=tx.type==='withdrawal_requested'?'requested':tx.type==='withdrawal_completed'?'paid':'reversed';
  return {type:'payout',payout:{id:`payout:${tx.accountId}:${tx.reference||tx.id}`,userId:tx.accountId,walletAccountId:walletId(tx.accountId),provider:tx.provider ?? 'ledger',providerPayoutId:tx.providerReference,amountCents:tx.amountCents,currency:'USD',status,idempotencyKey:`${tx.accountId}:${tx.reference||tx.id}`,requestedAt:tx.createdAt,processedAt:status==='requested'?null:tx.createdAt,metadata:{transactionId:tx.id}}};
}
function refundCommand(tx:LedgerTransaction):DataCommand|null {
  if(tx.type!=='refund')return null;
  return {type:'refund',refund:{id:`refund:${tx.id}`,userId:tx.accountId==='platform:revenue'?null:tx.accountId,ledgerTransactionId:tx.id,provider:tx.provider ?? 'ledger',providerRefundId:tx.providerReference,amountCents:tx.amountCents,currency:'USD',status:'succeeded',reason:tx.reference,idempotencyKey:`${tx.accountId}:${tx.idempotencyKey}`,createdAt:tx.createdAt,processedAt:tx.createdAt}};
}
function complianceCommand(profile:ComplianceProfile):DataCommand {
  const verified=Boolean(profile.identityVerifiedAt&&profile.ageVerifiedAt);
  return {type:'compliance_attestation',attestation:{id:`compliance:${profile.accountId}:${profile.verificationProvider ?? 'internal'}`,userId:profile.accountId,provider:profile.verificationProvider ?? 'internal',providerReference:profile.providerCustomerId,countryCode:profile.countryCode,regionCode:profile.regionCode,identityVerified:Boolean(profile.identityVerifiedAt),ageVerified:Boolean(profile.ageVerifiedAt),verifiedAge:profile.verifiedAge,taxProfileVerified:Boolean(profile.taxProfileVerifiedAt),status:verified?'verified':'pending',createdAt:Math.min(profile.updatedAt,profile.identityVerifiedAt ?? profile.updatedAt,profile.ageVerifiedAt ?? profile.updatedAt),updatedAt:profile.updatedAt,metadata:{legalNameVerified:Boolean(profile.legalNameVerifiedAt),dateOfBirthVerified:Boolean(profile.dateOfBirthVerifiedAt),sanctionsChecked:Boolean(profile.sanctionsCheckedAt),payoutMethodVerified:Boolean(profile.payoutMethodVerifiedAt)}}};
}

export class CanonicalPaymentLedger extends NotifyingPaymentLedger {
  private canonicalInternals():{ctx:DurableObjectState;env:PaymentProjectionEnv}{ return this as unknown as {ctx:DurableObjectState;env:PaymentProjectionEnv}; }
  private async projectLedger():Promise<void>{
    const {ctx,env}=this.canonicalInternals(); const ids=(await ctx.storage.get<string[]>('audit-index')) ?? []; const commands:DataCommand[]=[]; const accounts=new Set<string>();
    for(const id of ids.slice(0,250)){
      const tx=await ctx.storage.get<LedgerTransaction>(`tx:${id}`); if(!tx)continue; accounts.add(tx.accountId); commands.push(...walletCommands(tx.accountId,tx.createdAt)); const canonical=canonicalTransaction(tx); if(canonical)commands.push({type:'ledger_transaction',transaction:canonical}); const payout=payoutCommand(tx); if(payout)commands.push(payout); const refund=refundCommand(tx); if(refund)commands.push(refund);
    }
    for(const accountId of accounts){
      if(accountId==='platform:revenue')continue;
      const compliance=await ctx.storage.get<ComplianceProfile>(`compliance:${accountId}`); if(compliance)commands.push(complianceCommand(compliance));
      const entitlement=await ctx.storage.get<Entitlements>(`entitlements:${accountId}`); if(entitlement?.updatedAt)commands.push({type:'entitlement',entitlement:{id:`premium3d:${accountId}`,userId:accountId,entitlementKey:'premium3d',sourceType:'purchase',sourceId:null,status:entitlement.premium3d?'active':'revoked',startsAt:entitlement.updatedAt,createdAt:entitlement.updatedAt,updatedAt:entitlement.updatedAt}});
    }
    if(commands.length)await queueCanonicalProjection(ctx.storage,env,commands,`ledger-scan:${ids[0] ?? 'empty'}`);
  }
  private async paymentApiEvent(request:Request):Promise<Response>{
    const event=await request.json().catch(()=>null) as PaymentApiEvent|null; if(!event||event.kind!=='payment_intent'||!event.id||!event.provider||!event.idempotencyKey)return new Response(JSON.stringify({error:'Invalid canonical payment event.'}),{status:400,headers:{'content-type':'application/json'}});
    const {ctx,env}=this.canonicalInternals(); const commands:DataCommand[]=[{type:'payment_intent',intent:{id:event.id,userId:event.userId,provider:event.provider,providerIntentId:event.providerIntentId ?? null,purpose:event.purpose,amountCents:event.amountCents,currency:event.currency ?? 'USD',status:event.status,idempotencyKey:event.idempotencyKey,metadata:event.metadata,createdAt:event.createdAt,updatedAt:event.updatedAt,confirmedAt:event.status==='captured'?event.updatedAt:null}}];
    if(event.provider==='nuvei'&&event.userId)commands.unshift({type:'payment_customer',customer:{id:`nuvei:${event.userId}`,userId:event.userId,provider:'nuvei',providerCustomerId:event.userId,createdAt:event.createdAt,updatedAt:event.updatedAt}});
    await queueCanonicalProjection(ctx.storage,env,commands,`payment-api:${event.id}`); return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}});
  }
  override async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url); const {ctx,env}=this.canonicalInternals(); await drainCanonicalOutbox(ctx.storage,env).catch(()=>undefined);
    if(url.pathname==='/internal/canonical/payment-api'&&request.method==='POST')return this.paymentApiEvent(request);
    const response=await super.fetch(request); if(response.ok)await this.projectLedger().catch(()=>undefined); return response;
  }
}

export type CanonicalPaymentApiEvent=PaymentApiEvent;
