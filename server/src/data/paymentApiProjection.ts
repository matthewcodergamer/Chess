import { resolveAccountSession } from '../accounts';
import { handlePaymentRequest, type PaymentsEnv } from '../paymentApi';
import type { CanonicalPaymentApiEvent } from './paymentProjection';
import type { DataModelEnv } from './registry';

type CanonicalPaymentsEnv=PaymentsEnv & DataModelEnv;
type PaymentStub={fetch(request:Request):Promise<Response>};
function paymentStub(env:CanonicalPaymentsEnv):PaymentStub { return env.PAYMENTS.get(env.PAYMENTS.idFromName('qqurz-global-payment-ledger-v1')) as unknown as PaymentStub; }
async function sha256(value:string):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function enqueue(env:CanonicalPaymentsEnv,event:CanonicalPaymentApiEvent):Promise<void>{
  await paymentStub(env).fetch(new Request('https://payments.internal/internal/canonical/payment-api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)}));
}

export async function handleCanonicalPaymentRequest(request:Request,env:CanonicalPaymentsEnv):Promise<Response|null>{
  const url=new URL(request.url); if(!url.pathname.startsWith('/payments/'))return null;
  const clone=request.clone(); const identity=await resolveAccountSession(request,env).catch(()=>null); const response=await handlePaymentRequest(request,env); if(!response?.ok)return response;
  const now=Date.now();
  try{
    if(url.pathname==='/payments/premium/checkout'&&request.method==='POST'&&identity){
      const payload=await response.clone().json() as {provider?:string;sessionId?:string;amountCents?:number;currency?:string}; const idem=clone.headers.get('idempotency-key') ?? '';
      if(payload.sessionId&&idem)await enqueue(env,{kind:'payment_intent',id:`intent:stripe:${payload.sessionId}`,userId:identity.id,provider:'stripe',providerIntentId:payload.sessionId,purpose:'premium_purchase',amountCents:Number(payload.amountCents)||0,currency:payload.currency ?? 'USD',status:'created',idempotencyKey:`premium:${identity.id}:${idem}`,createdAt:now,updatedAt:now});
    }
    if(url.pathname==='/payments/deposit'&&request.method==='POST'&&identity){
      const payload=await response.clone().json() as {provider?:string;checkoutUrl?:string;amountCents?:number;currency?:string};
      if(payload.checkoutUrl){const hash=await sha256(payload.checkoutUrl);await enqueue(env,{kind:'payment_intent',id:`intent:nuvei:${hash.slice(0,32)}`,userId:identity.id,provider:'nuvei',purpose:'wallet_deposit',amountCents:Number(payload.amountCents)||0,currency:payload.currency ?? 'USD',status:'created',idempotencyKey:`deposit:${identity.id}:${hash}`,createdAt:now,updatedAt:now,metadata:{checkoutHash:hash}});}
    }
    if(url.pathname==='/payments/webhooks/stripe'&&request.method==='POST'){
      const event=await clone.json().catch(()=>null) as any; const session=event?.data?.object; const accountId=String(session?.metadata?.account_id ?? ''); const amount=Number(session?.metadata?.amount_cents ?? session?.amount_total ?? 0);
      if(event?.type==='checkout.session.completed'&&session?.id&&accountId&&Number.isSafeInteger(amount)&&amount>0)await enqueue(env,{kind:'payment_intent',id:`intent:stripe:${session.id}`,userId:accountId,provider:'stripe',providerIntentId:session.id,purpose:String(session?.metadata?.kind ?? 'premium_purchase'),amountCents:amount,currency:'USD',status:'captured',idempotencyKey:`provider:stripe:${session.id}`,createdAt:now,updatedAt:now,metadata:{webhookEventId:event.id ?? ''}});
    }
  }catch{
    // Provider/accounting behavior has already succeeded. Canonical projection is
    // best-effort here; the payment ledger outbox covers all money-changing rows.
  }
  return response;
}
