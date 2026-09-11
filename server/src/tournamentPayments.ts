import type { PaymentsEnv } from './paymentApi';

type LedgerStub = { fetch(request: Request): Promise<Response> };
type LedgerNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): LedgerStub };

function stub(env: PaymentsEnv): LedgerStub {
  const namespace = env.PAYMENTS as unknown as LedgerNamespace;
  return namespace.get(namespace.idFromName('qqurz-global-payment-ledger-v1'));
}

function headers(env: PaymentsEnv): Headers {
  const value = new Headers({ 'content-type': 'application/json' });
  value.set('x-payments-internal', env.PAYMENTS_INTERNAL_SECRET ?? '');
  return value;
}

export type TournamentPrizeShare = { accountId: string; shareBps: number; place: number };

export async function settleTournamentFunds(env: PaymentsEnv, input: {
  contestId: string;
  holdIds: string[];
  payouts: TournamentPrizeShare[];
}): Promise<{ ok: boolean; duplicate?: boolean; error?: string; settlement?: { potCents: number; feeCents: number; prizePoolCents: number; feePolicyId: string; payouts: Array<TournamentPrizeShare & { amountCents: number }> } }> {
  const response = await stub(env).fetch(new Request('https://payments.internal/internal/settle-tournament', {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(input),
  }));
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    duplicate?: boolean;
    error?: string;
    settlement?: { potCents: number; feeCents: number; prizePoolCents: number; feePolicyId: string; payouts: Array<TournamentPrizeShare & { amountCents: number }> };
  };
  return response.ok ? { ok: true, duplicate: payload.duplicate, settlement: payload.settlement } : { ok: false, error: payload.error || 'Tournament settlement failed.' };
}
