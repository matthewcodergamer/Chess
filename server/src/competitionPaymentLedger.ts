import { PaymentLedger, type LedgerTransaction, type PaymentLedgerEnv, type WalletSnapshot } from './paymentLedger';
import type { ComplianceProfile } from './paymentPolicy';
import { decideRealMoneyAccess } from './paymentPolicy';

type HoldRecord = {
  id: string;
  accountId: string;
  amountCents: number;
  purpose: 'friend_match_entry' | 'tournament_entry' | 'color_bid' | 'position_bid';
  reference: string;
  status: 'open' | 'released' | 'captured';
  createdAt: number;
  closedAt: number | null;
};

type PayoutInput = { accountId: string; shareBps: number; place?: number };
type SettlementResult = {
  contestId: string;
  potCents: number;
  feeCents: number;
  prizePoolCents: number;
  payouts: Array<{ accountId: string; shareBps: number; amountCents: number; place: number | null }>;
  settledAt: number;
};

type TxSpec = {
  type: LedgerTransaction['type'];
  purpose: LedgerTransaction['purpose'];
  amountCents: number;
  availableDeltaCents: number;
  heldDeltaCents: number;
  pendingWithdrawalDeltaCents?: number;
  feeCents?: number;
  idempotencyKey: string;
  reference: string;
  metadata?: Record<string, string>;
};

const PLATFORM_ACCOUNT = 'platform:revenue';
const MAX_REAL_MONEY_TOURNAMENT_ENTRANTS = 128;
const MAX_ACCOUNT_INDEX = 500;
const MAX_AUDIT_INDEX = 5000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function clean(value: unknown, max = 180): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function emptyWallet(accountId: string): WalletSnapshot {
  return { accountId, currency: 'USD', availableCents: 0, heldCents: 0, pendingWithdrawalCents: 0, debtCents: 0, updatedAt: Date.now(), sequence: 0, lastHash: '' };
}

function safeMetadata(value: Record<string, string> | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, raw]) => [clean(key, 48), clean(raw, 240)]).filter(([key]) => Boolean(key)));
}

export class CompetitionPaymentLedger extends PaymentLedger {
  private ledgerInternals(): { ctx: DurableObjectState; env: PaymentLedgerEnv } {
    return this as unknown as { ctx: DurableObjectState; env: PaymentLedgerEnv };
  }

  private tournamentInternalAuthorized(request: Request): boolean {
    const secret = this.ledgerInternals().env.PAYMENTS_INTERNAL_SECRET ?? '';
    return Boolean(secret) && request.headers.get('x-payments-internal') === secret;
  }

  private async settleTournament(request: Request): Promise<Response> {
    if (!this.tournamentInternalAuthorized(request)) return json({ error: 'Unauthorized payment subsystem call.' }, 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const contestId = clean(body.contestId, 180);
    const holdIds = Array.isArray(body.holdIds) ? body.holdIds.map(value => clean(value, 80)).filter(Boolean) : [];
    const payoutInput = Array.isArray(body.payouts) ? body.payouts : [];
    const feeBps = Math.max(0, Math.min(5000, Math.floor(Number(body.platformFeeBps ?? 2000))));
    if (!contestId || holdIds.length < 2 || holdIds.length > MAX_REAL_MONEY_TOURNAMENT_ENTRANTS) {
      return json({ error: `Real-money tournament settlement currently supports 2–${MAX_REAL_MONEY_TOURNAMENT_ENTRANTS} funded entrants.` }, 400);
    }

    const payouts: PayoutInput[] = payoutInput.map(raw => {
      const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return { accountId: clean(row.accountId, 80), shareBps: Math.floor(Number(row.shareBps)), place: Number.isInteger(row.place) ? Number(row.place) : undefined };
    }).filter(row => row.accountId && Number.isInteger(row.shareBps) && row.shareBps > 0 && row.shareBps <= 10_000);
    if (!payouts.length || new Set(payouts.map(row => row.accountId)).size !== payouts.length || payouts.reduce((sum, row) => sum + row.shareBps, 0) !== 10_000) {
      return json({ error: 'Tournament prize shares must name unique recipients and total exactly 100%.' }, 400);
    }

    const ctx = this.ledgerInternals().ctx;
    const already = await ctx.storage.get<SettlementResult>(`tournament-settled:${contestId}`);
    if (already) return json({ ok: true, duplicate: true, settlement: already });

    const holds: HoldRecord[] = [];
    for (const holdId of holdIds) {
      const hold = await ctx.storage.get<HoldRecord>(`hold:${holdId}`);
      if (!hold || hold.status !== 'open' || hold.purpose !== 'tournament_entry' || hold.reference !== contestId) return json({ error: `Entry hold ${holdId} is not available for this tournament.` }, 409);
      holds.push(hold);
    }
    const entrantIds = new Set(holds.map(hold => hold.accountId));
    if (entrantIds.size !== holds.length) return json({ error: 'Each tournament entrant must contribute exactly one entry hold.' }, 409);
    for (const payout of payouts) {
      if (!entrantIds.has(payout.accountId)) return json({ error: 'Every prize recipient must be a funded tournament entrant.' }, 400);
      const profile = await ctx.storage.get<ComplianceProfile>(`compliance:${payout.accountId}`) ?? null;
      const decision = decideRealMoneyAccess(this.ledgerInternals().env, profile, 'tournament_prize');
      if (!decision.allowed) return json({ error: decision.reason, jurisdiction: decision.jurisdiction, accountId: payout.accountId }, 403);
    }

    const potCents = holds.reduce((sum, hold) => sum + hold.amountCents, 0);
    const feeCents = Math.floor(potCents * feeBps / 10_000);
    const prizePoolCents = potCents - feeCents;
    let allocated = 0;
    const payoutAmounts = payouts.map((payout, index) => {
      const amountCents = index === payouts.length - 1 ? prizePoolCents - allocated : Math.floor(prizePoolCents * payout.shareBps / 10_000);
      allocated += amountCents;
      return { ...payout, amountCents, place: payout.place ?? null };
    });
    const settledAt = Date.now();

    try {
      await ctx.storage.transaction(async txn => {
        if (await txn.get<SettlementResult>(`tournament-settled:${contestId}`)) return;
        const audit = (await txn.get<string[]>('audit-index')) ?? [];
        const stagedAudit: string[] = [];
        const walletCache = new Map<string, WalletSnapshot>();
        const indexCache = new Map<string, string[]>();

        const walletFor = async (accountId: string): Promise<WalletSnapshot> => {
          let wallet = walletCache.get(accountId);
          if (!wallet) {
            wallet = (await txn.get<WalletSnapshot>(`wallet:${accountId}`)) ?? emptyWallet(accountId);
            walletCache.set(accountId, wallet);
          }
          return wallet;
        };
        const indexFor = async (accountId: string): Promise<string[]> => {
          let index = indexCache.get(accountId);
          if (!index) {
            index = (await txn.get<string[]>(`tx-index:${accountId}`)) ?? [];
            indexCache.set(accountId, index);
          }
          return index;
        };
        const append = async (accountId: string, spec: TxSpec): Promise<void> => {
          const existing = await txn.get<string>(`idem:${accountId}:${spec.idempotencyKey}`);
          if (existing) return;
          const wallet = await walletFor(accountId);
          if (wallet.availableCents + spec.availableDeltaCents < 0 || wallet.heldCents + spec.heldDeltaCents < 0) throw new Error('Ledger balance changed during tournament settlement.');
          const now = Date.now();
          const id = `txn_${crypto.randomUUID().replaceAll('-', '')}`;
          const sequence = wallet.sequence + 1;
          const previousHash = wallet.lastHash;
          const metadata = safeMetadata(spec.metadata);
          const canonical = JSON.stringify({ id, accountId, ...spec, metadata, sequence, previousHash, createdAt: now });
          const hash = await sha256(canonical);
          const next: WalletSnapshot = {
            ...wallet,
            availableCents: wallet.availableCents + spec.availableDeltaCents,
            heldCents: wallet.heldCents + spec.heldDeltaCents,
            pendingWithdrawalCents: wallet.pendingWithdrawalCents + (spec.pendingWithdrawalDeltaCents ?? 0),
            updatedAt: now,
            sequence,
            lastHash: hash,
          };
          const transaction: LedgerTransaction = {
            id,
            accountId,
            type: spec.type,
            purpose: spec.purpose,
            amountCents: spec.amountCents,
            availableDeltaCents: spec.availableDeltaCents,
            heldDeltaCents: spec.heldDeltaCents,
            pendingWithdrawalDeltaCents: spec.pendingWithdrawalDeltaCents ?? 0,
            feeCents: spec.feeCents ?? 0,
            currency: 'USD',
            idempotencyKey: spec.idempotencyKey,
            provider: null,
            providerReference: null,
            reference: spec.reference,
            metadata,
            createdAt: now,
            sequence,
            previousHash,
            hash,
            balanceAfter: { availableCents: next.availableCents, heldCents: next.heldCents, pendingWithdrawalCents: next.pendingWithdrawalCents, debtCents: next.debtCents },
          };
          walletCache.set(accountId, next);
          const index = await indexFor(accountId);
          indexCache.set(accountId, [id, ...index].slice(0, MAX_ACCOUNT_INDEX));
          stagedAudit.push(id);
          txn.put(`tx:${id}`, transaction);
          txn.put(`idem:${accountId}:${spec.idempotencyKey}`, id);
        };

        for (const hold of holds) {
          const current = await txn.get<HoldRecord>(`hold:${hold.id}`);
          if (!current || current.status !== 'open') throw new Error('An entry hold changed during settlement.');
          await append(hold.accountId, {
            type: 'hold_captured', purpose: 'tournament_entry', amountCents: hold.amountCents,
            availableDeltaCents: 0, heldDeltaCents: -hold.amountCents,
            idempotencyKey: `tournament-capture:${contestId}:${hold.id}`, reference: contestId,
          });
          current.status = 'captured'; current.closedAt = settledAt;
          txn.put(`hold:${hold.id}`, current);
        }
        if (feeCents > 0) await append(PLATFORM_ACCOUNT, {
          type: 'platform_fee', purpose: 'tournament_prize', amountCents: feeCents,
          availableDeltaCents: feeCents, heldDeltaCents: 0,
          idempotencyKey: `tournament-fee:${contestId}`, reference: contestId,
        });
        for (const payout of payoutAmounts) await append(payout.accountId, {
          type: 'tournament_prize', purpose: 'tournament_prize', amountCents: payout.amountCents,
          availableDeltaCents: payout.amountCents, heldDeltaCents: 0,
          idempotencyKey: `tournament-prize:${contestId}:${payout.accountId}`,
          reference: contestId,
          metadata: { place: String(payout.place ?? ''), shareBps: String(payout.shareBps) },
        });

        for (const [accountId, wallet] of walletCache) txn.put(`wallet:${accountId}`, wallet);
        for (const [accountId, index] of indexCache) txn.put(`tx-index:${accountId}`, index);
        txn.put('audit-index', [...stagedAudit.reverse(), ...audit].slice(0, MAX_AUDIT_INDEX));
        const settlement: SettlementResult = { contestId, potCents, feeCents, prizePoolCents, payouts: payoutAmounts, settledAt };
        txn.put(`tournament-settled:${contestId}`, settlement);
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Tournament settlement failed.' }, 409);
    }
    return json({ ok: true, settlement: await ctx.storage.get<SettlementResult>(`tournament-settled:${contestId}`) });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/settle-tournament' && request.method === 'POST') return this.settleTournament(request);
    return super.fetch(request);
  }
}

export { MAX_REAL_MONEY_TOURNAMENT_ENTRANTS };
