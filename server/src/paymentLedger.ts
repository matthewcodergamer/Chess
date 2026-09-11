import { DurableObject } from 'cloudflare:workers';
import type { ComplianceProfile, MoneyPurpose, PaymentPolicyEnv } from './paymentPolicy';
import { decideRealMoneyAccess } from './paymentPolicy';

export type PaymentLedgerEnv = PaymentPolicyEnv & {
  PAYMENTS_INTERNAL_SECRET?: string;
};

export type WalletSnapshot = {
  accountId: string;
  currency: 'USD';
  availableCents: number;
  heldCents: number;
  pendingWithdrawalCents: number;
  debtCents: number;
  updatedAt: number;
  sequence: number;
  lastHash: string;
};

export type LedgerTransactionType =
  | 'deposit_confirmed'
  | 'deposit_reversed'
  | 'hold_created'
  | 'hold_released'
  | 'hold_captured'
  | 'friend_match_prize'
  | 'tournament_prize'
  | 'platform_fee'
  | 'premium_purchase'
  | 'color_bid'
  | 'position_bid'
  | 'refund'
  | 'withdrawal_requested'
  | 'withdrawal_completed'
  | 'withdrawal_reversed'
  | 'adjustment';

export type LedgerTransaction = {
  id: string;
  accountId: string;
  type: LedgerTransactionType;
  purpose: MoneyPurpose;
  amountCents: number;
  availableDeltaCents: number;
  heldDeltaCents: number;
  pendingWithdrawalDeltaCents: number;
  feeCents: number;
  currency: 'USD';
  idempotencyKey: string;
  provider: string | null;
  providerReference: string | null;
  reference: string;
  metadata: Record<string, string>;
  createdAt: number;
  sequence: number;
  previousHash: string;
  hash: string;
  balanceAfter: Pick<WalletSnapshot, 'availableCents' | 'heldCents' | 'pendingWithdrawalCents' | 'debtCents'>;
};

type HoldRecord = {
  id: string;
  accountId: string;
  amountCents: number;
  purpose: Extract<MoneyPurpose, 'friend_match_entry' | 'tournament_entry' | 'color_bid' | 'position_bid'>;
  reference: string;
  status: 'open' | 'released' | 'captured';
  createdAt: number;
  closedAt: number | null;
};

type Entitlements = { premium3d: boolean; updatedAt: number };

type Mutation = {
  type: LedgerTransactionType;
  purpose: MoneyPurpose;
  amountCents: number;
  availableDeltaCents?: number;
  heldDeltaCents?: number;
  pendingWithdrawalDeltaCents?: number;
  feeCents?: number;
  idempotencyKey: string;
  provider?: string | null;
  providerReference?: string | null;
  reference?: string;
  metadata?: Record<string, string>;
};

const PLATFORM_ACCOUNT = 'platform:revenue';
const MAX_ACCOUNT_INDEX = 500;
const MAX_AUDIT_INDEX = 5000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function cents(value: unknown, max = 10_000_000): number {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 && amount <= max ? amount : 0;
}

function cleanText(value: unknown, max = 160): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function cleanMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    const safeKey = cleanText(key, 48).replace(/[^A-Za-z0-9_.:-]/g, '');
    if (safeKey) output[safeKey] = cleanText(raw, 240);
  }
  return output;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function emptyWallet(accountId: string): WalletSnapshot {
  return {
    accountId,
    currency: 'USD',
    availableCents: 0,
    heldCents: 0,
    pendingWithdrawalCents: 0,
    debtCents: 0,
    updatedAt: Date.now(),
    sequence: 0,
    lastHash: '',
  };
}

export class PaymentLedger extends DurableObject<PaymentLedgerEnv> {
  constructor(ctx: DurableObjectState, env: PaymentLedgerEnv) {
    super(ctx, env);
  }

  private async wallet(accountId: string): Promise<WalletSnapshot> {
    return (await this.ctx.storage.get<WalletSnapshot>(`wallet:${accountId}`)) ?? emptyWallet(accountId);
  }

  private async profile(accountId: string): Promise<ComplianceProfile | null> {
    return (await this.ctx.storage.get<ComplianceProfile>(`compliance:${accountId}`)) ?? null;
  }

  private async entitlement(accountId: string): Promise<Entitlements> {
    return (await this.ctx.storage.get<Entitlements>(`entitlements:${accountId}`)) ?? { premium3d: false, updatedAt: 0 };
  }

  private internalAuthorized(request: Request): boolean {
    const secret = this.env.PAYMENTS_INTERNAL_SECRET ?? '';
    return Boolean(secret) && request.headers.get('x-payments-internal') === secret;
  }

  private async append(accountId: string, mutation: Mutation): Promise<{ wallet: WalletSnapshot; transaction: LedgerTransaction; duplicate: boolean }> {
    const idem = cleanText(mutation.idempotencyKey, 180);
    if (!idem) throw new Error('Missing idempotency key.');
    const duplicateId = await this.ctx.storage.get<string>(`idem:${accountId}:${idem}`);
    if (duplicateId) {
      const transaction = await this.ctx.storage.get<LedgerTransaction>(`tx:${duplicateId}`);
      if (!transaction) throw new Error('Ledger idempotency index is inconsistent.');
      return { wallet: await this.wallet(accountId), transaction, duplicate: true };
    }

    const wallet = await this.wallet(accountId);
    const availableDelta = Math.trunc(mutation.availableDeltaCents ?? 0);
    const heldDelta = Math.trunc(mutation.heldDeltaCents ?? 0);
    const pendingDelta = Math.trunc(mutation.pendingWithdrawalDeltaCents ?? 0);
    if (wallet.availableCents + availableDelta < 0) throw new Error('Insufficient available balance.');
    if (wallet.heldCents + heldDelta < 0) throw new Error('Insufficient held balance.');
    if (wallet.pendingWithdrawalCents + pendingDelta < 0) throw new Error('Insufficient pending withdrawal balance.');

    const now = Date.now();
    const next: WalletSnapshot = {
      ...wallet,
      availableCents: wallet.availableCents + availableDelta,
      heldCents: wallet.heldCents + heldDelta,
      pendingWithdrawalCents: wallet.pendingWithdrawalCents + pendingDelta,
      updatedAt: now,
      sequence: wallet.sequence + 1,
    };
    const id = `txn_${crypto.randomUUID().replaceAll('-', '')}`;
    const canonical = JSON.stringify({
      id,
      accountId,
      type: mutation.type,
      purpose: mutation.purpose,
      amountCents: mutation.amountCents,
      availableDelta,
      heldDelta,
      pendingDelta,
      feeCents: Math.max(0, Math.trunc(mutation.feeCents ?? 0)),
      idempotencyKey: idem,
      provider: mutation.provider ?? null,
      providerReference: mutation.providerReference ?? null,
      reference: cleanText(mutation.reference, 180),
      metadata: cleanMetadata(mutation.metadata),
      createdAt: now,
      sequence: next.sequence,
      previousHash: wallet.lastHash,
    });
    const hash = await sha256(canonical);
    next.lastHash = hash;
    const transaction: LedgerTransaction = {
      id,
      accountId,
      type: mutation.type,
      purpose: mutation.purpose,
      amountCents: Math.max(0, Math.trunc(mutation.amountCents)),
      availableDeltaCents: availableDelta,
      heldDeltaCents: heldDelta,
      pendingWithdrawalDeltaCents: pendingDelta,
      feeCents: Math.max(0, Math.trunc(mutation.feeCents ?? 0)),
      currency: 'USD',
      idempotencyKey: idem,
      provider: mutation.provider ?? null,
      providerReference: mutation.providerReference ?? null,
      reference: cleanText(mutation.reference, 180),
      metadata: cleanMetadata(mutation.metadata),
      createdAt: now,
      sequence: next.sequence,
      previousHash: wallet.lastHash,
      hash,
      balanceAfter: {
        availableCents: next.availableCents,
        heldCents: next.heldCents,
        pendingWithdrawalCents: next.pendingWithdrawalCents,
        debtCents: next.debtCents,
      },
    };

    const accountIndex = (await this.ctx.storage.get<string[]>(`tx-index:${accountId}`)) ?? [];
    const auditIndex = (await this.ctx.storage.get<string[]>('audit-index')) ?? [];
    await this.ctx.storage.put({
      [`wallet:${accountId}`]: next,
      [`tx:${id}`]: transaction,
      [`idem:${accountId}:${idem}`]: id,
      [`tx-index:${accountId}`]: [id, ...accountIndex.filter(value => value !== id)].slice(0, MAX_ACCOUNT_INDEX),
      'audit-index': [id, ...auditIndex.filter(value => value !== id)].slice(0, MAX_AUDIT_INDEX),
    });
    return { wallet: next, transaction, duplicate: false };
  }

  private async createHold(body: Record<string, unknown>): Promise<Response> {
    const accountId = cleanText(body.accountId, 80);
    const amountCents = cents(body.amountCents);
    const purpose = body.purpose;
    const reference = cleanText(body.reference, 180);
    const idempotencyKey = cleanText(body.idempotencyKey, 180);
    if (!accountId || !amountCents || !reference || !idempotencyKey || !['friend_match_entry', 'tournament_entry', 'color_bid', 'position_bid'].includes(String(purpose))) {
      return json({ error: 'Invalid hold request.' }, 400);
    }
    const existingHoldId = await this.ctx.storage.get<string>(`hold-idem:${accountId}:${idempotencyKey}`);
    if (existingHoldId) {
      const existing = await this.ctx.storage.get<HoldRecord>(`hold:${existingHoldId}`);
      return json({ hold: existing, wallet: await this.wallet(accountId), duplicate: true });
    }
    const profile = await this.profile(accountId);
    const decision = decideRealMoneyAccess(this.env, profile, purpose as MoneyPurpose);
    if (!decision.allowed) return json({ error: decision.reason, jurisdiction: decision.jurisdiction }, 403);
    try {
      const holdId = `hold_${crypto.randomUUID().replaceAll('-', '')}`;
      const result = await this.append(accountId, {
        type: 'hold_created', purpose: purpose as MoneyPurpose, amountCents,
        availableDeltaCents: -amountCents, heldDeltaCents: amountCents,
        idempotencyKey: `hold:${idempotencyKey}`, reference,
      });
      const hold: HoldRecord = { id: holdId, accountId, amountCents, purpose: purpose as HoldRecord['purpose'], reference, status: 'open', createdAt: Date.now(), closedAt: null };
      await this.ctx.storage.put({ [`hold:${holdId}`]: hold, [`hold-idem:${accountId}:${idempotencyKey}`]: holdId });
      return json({ hold, wallet: result.wallet, duplicate: result.duplicate }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Could not hold funds.' }, 409);
    }
  }

  private async releaseHold(body: Record<string, unknown>): Promise<Response> {
    const holdId = cleanText(body.holdId, 80);
    const idempotencyKey = cleanText(body.idempotencyKey, 180);
    const hold = await this.ctx.storage.get<HoldRecord>(`hold:${holdId}`);
    if (!hold) return json({ error: 'Hold not found.' }, 404);
    if (hold.status === 'released') return json({ hold, wallet: await this.wallet(hold.accountId), duplicate: true });
    if (hold.status !== 'open') return json({ error: 'Hold has already been captured.' }, 409);
    try {
      const result = await this.append(hold.accountId, {
        type: 'hold_released', purpose: hold.purpose, amountCents: hold.amountCents,
        availableDeltaCents: hold.amountCents, heldDeltaCents: -hold.amountCents,
        idempotencyKey: `release:${idempotencyKey || holdId}`, reference: hold.reference,
      });
      hold.status = 'released'; hold.closedAt = Date.now();
      await this.ctx.storage.put(`hold:${holdId}`, hold);
      return json({ hold, wallet: result.wallet });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Could not release hold.' }, 409);
    }
  }

  private async settleContest(body: Record<string, unknown>): Promise<Response> {
    const contestId = cleanText(body.contestId, 180);
    const winnerAccountId = cleanText(body.winnerAccountId, 80);
    const holdIds = Array.isArray(body.holdIds) ? body.holdIds.map(value => cleanText(value, 80)).filter(Boolean).slice(0, 4096) : [];
    const feeBps = Math.max(0, Math.min(5000, Math.floor(Number(body.platformFeeBps ?? 2000))));
    const prizePurpose: MoneyPurpose = body.prizePurpose === 'tournament_prize' ? 'tournament_prize' : 'friend_match_prize';
    if (!contestId || !winnerAccountId || holdIds.length < 2) return json({ error: 'Invalid contest settlement.' }, 400);
    if (await this.ctx.storage.get<boolean>(`contest-settled:${contestId}`)) return json({ ok: true, duplicate: true });

    const holds: HoldRecord[] = [];
    for (const holdId of holdIds) {
      const hold = await this.ctx.storage.get<HoldRecord>(`hold:${holdId}`);
      if (!hold || hold.status !== 'open') return json({ error: `Hold ${holdId} is unavailable.` }, 409);
      holds.push(hold);
    }
    if (!holds.some(hold => hold.accountId === winnerAccountId)) return json({ error: 'Winner must be one of the funded participants.' }, 400);
    const winnerDecision = decideRealMoneyAccess(this.env, await this.profile(winnerAccountId), prizePurpose);
    if (!winnerDecision.allowed) return json({ error: winnerDecision.reason, jurisdiction: winnerDecision.jurisdiction }, 403);

    const potCents = holds.reduce((sum, hold) => sum + hold.amountCents, 0);
    const feeCents = Math.floor((potCents * feeBps) / 10_000);
    const prizeCents = potCents - feeCents;
    try {
      for (const hold of holds) {
        await this.append(hold.accountId, {
          type: 'hold_captured', purpose: hold.purpose, amountCents: hold.amountCents,
          heldDeltaCents: -hold.amountCents, idempotencyKey: `capture:${contestId}:${hold.id}`, reference: contestId,
        });
        hold.status = 'captured'; hold.closedAt = Date.now();
        await this.ctx.storage.put(`hold:${hold.id}`, hold);
      }
      const winner = await this.append(winnerAccountId, {
        type: prizePurpose === 'tournament_prize' ? 'tournament_prize' : 'friend_match_prize',
        purpose: prizePurpose, amountCents: prizeCents, availableDeltaCents: prizeCents,
        feeCents, idempotencyKey: `prize:${contestId}`, reference: contestId,
      });
      if (feeCents > 0) await this.append(PLATFORM_ACCOUNT, {
        type: 'platform_fee', purpose: prizePurpose, amountCents: feeCents, availableDeltaCents: feeCents,
        idempotencyKey: `fee:${contestId}`, reference: contestId,
      });
      await this.ctx.storage.put(`contest-settled:${contestId}`, true);
      return json({ ok: true, potCents, feeCents, prizeCents, winnerWallet: winner.wallet });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Settlement failed.' }, 409);
    }
  }

  private async creditProviderPayment(body: Record<string, unknown>): Promise<Response> {
    const accountId = cleanText(body.accountId, 80);
    const amountCents = cents(body.amountCents);
    const provider = cleanText(body.provider, 32);
    const providerReference = cleanText(body.providerReference, 180);
    const purpose: MoneyPurpose = body.purpose === 'premium_purchase' ? 'premium_purchase' : 'wallet_deposit';
    const idempotencyKey = cleanText(body.idempotencyKey, 180) || `${provider}:${providerReference}`;
    if (!accountId || !amountCents || !provider || !providerReference) return json({ error: 'Invalid provider credit.' }, 400);
    if (purpose === 'wallet_deposit') {
      const decision = decideRealMoneyAccess(this.env, await this.profile(accountId), 'wallet_deposit');
      if (!decision.allowed) return json({ error: decision.reason, jurisdiction: decision.jurisdiction }, 403);
    }
    try {
      if (purpose === 'premium_purchase') {
        const current = await this.entitlement(accountId);
        const result = await this.append(accountId, {
          type: 'premium_purchase', purpose, amountCents, idempotencyKey,
          provider, providerReference, reference: cleanText(body.reference, 180), metadata: cleanMetadata(body.metadata),
        });
        await this.ctx.storage.put(`entitlements:${accountId}`, { ...current, premium3d: true, updatedAt: Date.now() } satisfies Entitlements);
        return json({ ok: true, wallet: result.wallet, entitlement: await this.entitlement(accountId), duplicate: result.duplicate });
      }
      const result = await this.append(accountId, {
        type: 'deposit_confirmed', purpose, amountCents, availableDeltaCents: amountCents,
        idempotencyKey, provider, providerReference, reference: cleanText(body.reference, 180), metadata: cleanMetadata(body.metadata),
      });
      return json({ ok: true, wallet: result.wallet, duplicate: result.duplicate });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Provider credit failed.' }, 409);
    }
  }

  private async requestWithdrawal(body: Record<string, unknown>): Promise<Response> {
    const accountId = cleanText(body.accountId, 80);
    const amountCents = cents(body.amountCents);
    const idempotencyKey = cleanText(body.idempotencyKey, 180);
    if (!accountId || amountCents < 100 || !idempotencyKey) return json({ error: 'Invalid withdrawal request.' }, 400);
    const decision = decideRealMoneyAccess(this.env, await this.profile(accountId), 'withdrawal');
    if (!decision.allowed) return json({ error: decision.reason, jurisdiction: decision.jurisdiction }, 403);
    try {
      const result = await this.append(accountId, {
        type: 'withdrawal_requested', purpose: 'withdrawal', amountCents,
        availableDeltaCents: -amountCents, pendingWithdrawalDeltaCents: amountCents,
        idempotencyKey: `withdraw:${idempotencyKey}`, reference: cleanText(body.reference, 180),
      });
      return json({ ok: true, wallet: result.wallet, transaction: result.transaction, duplicate: result.duplicate }, 202);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Withdrawal could not be reserved.' }, 409);
    }
  }

  private async completeWithdrawal(body: Record<string, unknown>, reverse: boolean): Promise<Response> {
    const accountId = cleanText(body.accountId, 80);
    const amountCents = cents(body.amountCents);
    const provider = cleanText(body.provider, 32);
    const providerReference = cleanText(body.providerReference, 180);
    const idempotencyKey = cleanText(body.idempotencyKey, 180) || `${provider}:${providerReference}`;
    if (!accountId || !amountCents || !providerReference) return json({ error: 'Invalid withdrawal completion.' }, 400);
    try {
      const result = await this.append(accountId, {
        type: reverse ? 'withdrawal_reversed' : 'withdrawal_completed', purpose: reverse ? 'refund' : 'withdrawal', amountCents,
        availableDeltaCents: reverse ? amountCents : 0,
        pendingWithdrawalDeltaCents: -amountCents,
        idempotencyKey: `${reverse ? 'withdraw-reverse' : 'withdraw-complete'}:${idempotencyKey}`,
        provider, providerReference, reference: cleanText(body.reference, 180), metadata: cleanMetadata(body.metadata),
      });
      return json({ ok: true, wallet: result.wallet, transaction: result.transaction, duplicate: result.duplicate });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Withdrawal update failed.' }, 409);
    }
  }

  private async walletResponse(accountId: string): Promise<Response> {
    const profile = await this.profile(accountId);
    const deposit = decideRealMoneyAccess(this.env, profile, 'wallet_deposit');
    const play = decideRealMoneyAccess(this.env, profile, 'friend_match_entry');
    const tournament = decideRealMoneyAccess(this.env, profile, 'tournament_entry');
    const withdrawal = decideRealMoneyAccess(this.env, profile, 'withdrawal');
    return json({
      wallet: await this.wallet(accountId),
      compliance: profile ? { countryCode: profile.countryCode, regionCode: profile.regionCode, verifiedAge: profile.verifiedAge, identityVerified: Boolean(profile.identityVerifiedAt), ageVerified: Boolean(profile.ageVerifiedAt), taxProfileVerified: Boolean(profile.taxProfileVerifiedAt) } : null,
      capabilities: { deposit, friendMatch: play, tournament, withdrawal },
      entitlements: await this.entitlement(accountId),
    });
  }

  private async transactions(accountId: string): Promise<Response> {
    const ids = (await this.ctx.storage.get<string[]>(`tx-index:${accountId}`)) ?? [];
    const transactions = (await Promise.all(ids.slice(0, 100).map(id => this.ctx.storage.get<LedgerTransaction>(`tx:${id}`)))).filter(Boolean);
    return json({ transactions });
  }

  private async updateCompliance(body: Record<string, unknown>): Promise<Response> {
    const accountId = cleanText(body.accountId, 80);
    if (!accountId) return json({ error: 'Missing account id.' }, 400);
    const verifiedAge = Number.isFinite(Number(body.verifiedAge)) ? Math.floor(Number(body.verifiedAge)) : null;
    const now = Date.now();
    const profile: ComplianceProfile = {
      accountId,
      identityVerifiedAt: body.identityVerified === true ? now : null,
      ageVerifiedAt: body.ageVerified === true ? now : null,
      verifiedAge,
      countryCode: cleanText(body.countryCode, 2).toUpperCase(),
      regionCode: cleanText(body.regionCode, 8).toUpperCase(),
      taxProfileVerifiedAt: body.taxProfileVerified === true ? now : null,
      sanctionsCheckedAt: body.sanctionsChecked === true ? now : null,
      providerCustomerId: body.providerCustomerId ? cleanText(body.providerCustomerId, 180) : null,
      updatedAt: now,
    };
    await this.ctx.storage.put(`compliance:${accountId}`, profile);
    return json({ ok: true, profile });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const internal = path.startsWith('/internal/');
    if (internal && !this.internalAuthorized(request)) return json({ error: 'Unauthorized payment subsystem call.' }, 401);

    if (path.startsWith('/wallet/') && request.method === 'GET') return this.walletResponse(cleanText(path.slice('/wallet/'.length), 80));
    if (path.startsWith('/transactions/') && request.method === 'GET') return this.transactions(cleanText(path.slice('/transactions/'.length), 80));

    const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
    if (path === '/internal/compliance' && request.method === 'POST') return this.updateCompliance(body);
    if (path === '/internal/provider-credit' && request.method === 'POST') return this.creditProviderPayment(body);
    if (path === '/internal/hold' && request.method === 'POST') return this.createHold(body);
    if (path === '/internal/release-hold' && request.method === 'POST') return this.releaseHold(body);
    if (path === '/internal/settle-contest' && request.method === 'POST') return this.settleContest(body);
    if (path === '/internal/request-withdrawal' && request.method === 'POST') return this.requestWithdrawal(body);
    if (path === '/internal/complete-withdrawal' && request.method === 'POST') return this.completeWithdrawal(body, false);
    if (path === '/internal/reverse-withdrawal' && request.method === 'POST') return this.completeWithdrawal(body, true);
    return json({ error: 'Payment ledger route not found.' }, 404);
  }
}
