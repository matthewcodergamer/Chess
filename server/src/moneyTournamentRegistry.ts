import { positiveCents } from '../../shared/money';
import { EngineTournamentRegistry } from './tournamentEngineRegistry';
import type { EngineTournament } from './tournamentEngineTypes';
import type { TournamentEngineEnv } from './tournamentEngineApi';
import { holdCompetitionFunds, releaseCompetitionHold, type PaymentsEnv } from './paymentApi';
import { feePolicyForPurpose } from './paymentPolicy';
import { settleTournamentFunds, type TournamentPrizeShare } from './tournamentPayments';

const TOURNAMENT_KEY = 'engine:tournament:v1:';
const MONEY_KEY = 'engine:tournament-money:v1:';
const MONEY_INDEX = 'engine:tournament-money-index:v1';
const MAX_REAL_MONEY_ENTRANTS = 128;

type MoneyTournamentControl = {
  tournamentId: string;
  entryFeeCents: number;
  holdByAccount: Record<string, string>;
  status: 'registration' | 'active' | 'settled' | 'released' | 'settlement_error';
  settlementError: string | null;
  createdAt: number;
  updatedAt: number;
};

type MoneyTournamentEnv = TournamentEngineEnv & PaymentsEnv;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function entryFeeCents(definition: Record<string, unknown> | undefined): number {
  const entry = definition?.entryRules && typeof definition.entryRules === 'object' ? definition.entryRules as Record<string, unknown> : {};
  const raw = entry.entryFeeCents ?? definition?.entryFeeCents;
  const amount = positiveCents(raw, 100_000);
  return amount >= 100 ? amount : 0;
}

function payoutShares(definition: Record<string, unknown> | undefined): Array<{ place: number; shareBps: number }> {
  const payout = definition?.payout && typeof definition.payout === 'object' ? definition.payout as Record<string, unknown> : {};
  if (payout.mode !== 'percent' || !Array.isArray(payout.places)) return [];
  return payout.places.map(raw => {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      place: Number.isSafeInteger(row.place) ? Number(row.place) : Math.floor(Number(row.place)),
      shareBps: Number.isSafeInteger(row.value) ? Number(row.value) : Math.floor(Number(row.value)),
    };
  }).filter(row => Number.isSafeInteger(row.place) && row.place > 0 && Number.isSafeInteger(row.shareBps) && row.shareBps > 0 && row.shareBps <= 10_000);
}

export class MoneyTournamentRegistry extends EngineTournamentRegistry {
  private moneyInternals(): { ctx: DurableObjectState; env: MoneyTournamentEnv } {
    return this as unknown as { ctx: DurableObjectState; env: MoneyTournamentEnv };
  }

  private async control(id: string): Promise<MoneyTournamentControl | null> {
    return (await this.moneyInternals().ctx.storage.get<MoneyTournamentControl>(`${MONEY_KEY}${id}`)) ?? null;
  }

  private async putControl(control: MoneyTournamentControl): Promise<void> {
    control.updatedAt = Date.now();
    const ctx = this.moneyInternals().ctx;
    await ctx.storage.put(`${MONEY_KEY}${control.tournamentId}`, control);
    const index = (await ctx.storage.get<string[]>(MONEY_INDEX)) ?? [];
    if (!index.includes(control.tournamentId)) await ctx.storage.put(MONEY_INDEX, [control.tournamentId, ...index].slice(0, 500));
  }

  private async tournament(id: string): Promise<EngineTournament | null> {
    return (await this.moneyInternals().ctx.storage.get<EngineTournament>(`${TOURNAMENT_KEY}${id}`)) ?? null;
  }

  private async createMoneyControl(response: Response, definition: Record<string, unknown> | undefined): Promise<Response> {
    const fee = entryFeeCents(definition);
    if (!fee || !response.ok) return response;
    const payload = await response.clone().json().catch(() => ({})) as { tournament?: { id?: string } };
    const tournamentId = String(payload.tournament?.id ?? '');
    if (!tournamentId) return response;
    const now = Date.now();
    await this.putControl({
      tournamentId,
      entryFeeCents: fee,
      holdByAccount: {},
      status: 'registration',
      settlementError: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.enrichResponse(response, tournamentId);
  }

  private async registerMoney(request: Request, body: Record<string, unknown>, control: MoneyTournamentControl): Promise<Response> {
    const accountId = String(body.accountId ?? '');
    if (!accountId) return json({ error: 'Account identity is required for a paid tournament.' }, 401);
    const held = await holdCompetitionFunds(this.moneyInternals().env, {
      accountId,
      amountCents: control.entryFeeCents,
      purpose: 'tournament_entry',
      reference: control.tournamentId,
      idempotencyKey: `tournament-entry:${control.tournamentId}:${accountId}:${control.entryFeeCents}`,
    });
    if (!held.ok || !held.holdId) return json({ error: held.error || 'Tournament entry funds could not be reserved.' }, 403);

    const response = await super.fetch(request);
    if (!response.ok) {
      await releaseCompetitionHold(this.moneyInternals().env, { holdId: held.holdId, idempotencyKey: `registration-failed:${control.tournamentId}:${accountId}` });
      return response;
    }
    control.holdByAccount[accountId] = held.holdId;
    control.settlementError = null;
    await this.putControl(control);
    await this.reconcile(control.tournamentId);
    return this.enrichResponse(response, control.tournamentId);
  }

  private async releaseAccount(control: MoneyTournamentControl, accountId: string, reason: string): Promise<void> {
    const holdId = control.holdByAccount[accountId];
    if (!holdId) return;
    await releaseCompetitionHold(this.moneyInternals().env, { holdId, idempotencyKey: `${reason}:${control.tournamentId}:${accountId}` });
    delete control.holdByAccount[accountId];
  }

  private async releaseAll(control: MoneyTournamentControl, reason: string): Promise<void> {
    for (const accountId of Object.keys(control.holdByAccount)) await this.releaseAccount(control, accountId, reason);
    control.status = 'released';
    control.settlementError = null;
    await this.putControl(control);
  }

  private async settleCompleted(control: MoneyTournamentControl, tournament: EngineTournament): Promise<void> {
    if (control.status === 'settled' || control.status === 'released') return;
    const standings = tournament.finalStandings ?? [];
    const rules = tournament.payout.mode === 'percent' ? tournament.payout.places : [];
    const payouts: TournamentPrizeShare[] = [];
    for (const rule of rules) {
      const standing = standings.find(row => row.rank === rule.place);
      const participant = standing ? tournament.participants[standing.participantId] : null;
      if (!participant) {
        await this.releaseAll(control, 'payout-table-unfulfilled');
        control.settlementError = `Prize place ${rule.place} was not filled; entry holds were released instead of guessing a redistribution.`;
        control.status = 'settlement_error';
        await this.putControl(control);
        return;
      }
      payouts.push({ accountId: participant.accountId, shareBps: rule.value, place: rule.place });
    }
    const holdIds = Object.values(control.holdByAccount);
    if (holdIds.length < 2) {
      await this.releaseAll(control, 'insufficient-funded-entrants');
      return;
    }
    const result = await settleTournamentFunds(this.moneyInternals().env, {
      contestId: control.tournamentId,
      holdIds,
      payouts,
    });
    if (!result.ok) {
      control.status = 'settlement_error';
      control.settlementError = result.error || 'Tournament settlement failed and requires review.';
      await this.putControl(control);
      return;
    }
    control.status = 'settled';
    control.settlementError = null;
    await this.putControl(control);
  }

  private async reconcile(id: string): Promise<void> {
    const control = await this.control(id);
    if (!control || control.status === 'settled' || control.status === 'released') return;
    const tournament = await this.tournament(id);
    if (!tournament) return;
    if (tournament.status === 'cancelled') {
      await this.releaseAll(control, 'tournament-cancelled');
      return;
    }
    if (tournament.startedAt) {
      const activeAccountIds = new Set(Object.values(tournament.participants).filter(player => player.status !== 'withdrawn').map(player => player.accountId));
      for (const accountId of Object.keys(control.holdByAccount)) {
        if (!activeAccountIds.has(accountId)) await this.releaseAccount(control, accountId, 'pre-start-withdrawal');
      }
      if (control.status === 'registration') control.status = 'active';
      await this.putControl(control);
    }
    if (tournament.status === 'completed') await this.settleCompleted(control, tournament);
  }

  private async enrichResponse(response: Response, tournamentId?: string): Promise<Response> {
    if (!response.ok) return response;
    const payload = await response.clone().json().catch(() => null) as Record<string, any> | null;
    if (!payload) return response;
    if (Array.isArray(payload.tournaments)) {
      payload.tournaments = await Promise.all(payload.tournaments.map(async (row: Record<string, unknown>) => {
        const control = await this.control(String(row.id ?? ''));
        return control ? { ...row, entryFeeCents: control.entryFeeCents, moneyStatus: control.status } : row;
      }));
      return json(payload, response.status);
    }
    const id = tournamentId ?? String(payload.tournament?.id ?? '');
    const control = id ? await this.control(id) : null;
    if (control && payload.tournament && typeof payload.tournament === 'object') {
      const feePolicy = feePolicyForPurpose('tournament_prize');
      payload.tournament = {
        ...payload.tournament,
        entryFeeCents: control.entryFeeCents,
        platformFeeBps: feePolicy.platformFeeBps,
        feePolicyId: feePolicy.id,
        moneyStatus: control.status,
        moneySettlementError: control.settlementError,
      };
    }
    return json(payload, response.status);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== 'tournament.internal') return super.fetch(request);
    const body = request.method === 'POST' ? await request.clone().json().catch(() => ({})) as Record<string, unknown> : {};

    if (request.method === 'POST' && url.pathname === '/engine/create') {
      const definition = body.definition && typeof body.definition === 'object' ? body.definition as Record<string, unknown> : undefined;
      const fee = entryFeeCents(definition);
      if (fee) {
        if (this.moneyInternals().env.REAL_MONEY_ENABLED !== 'enabled') return json({ error: 'Real-money tournaments are disabled by operator policy.' }, 403);
        const capacity = Math.floor(Number(definition?.capacity));
        const shares = payoutShares(definition);
        const uniquePlaces = new Set(shares.map(row => row.place));
        const maxPlace = shares.length ? Math.max(...shares.map(row => row.place)) : 0;
        if (!Number.isFinite(capacity) || capacity < 2 || capacity > MAX_REAL_MONEY_ENTRANTS) return json({ error: `Real-money tournaments currently support 2–${MAX_REAL_MONEY_ENTRANTS} entrants.` }, 400);
        if (!shares.length || shares.reduce((sum, row) => sum + row.shareBps, 0) !== 10_000 || uniquePlaces.size !== shares.length) return json({ error: 'Real-money percentage payouts must use unique places and total exactly 100%.' }, 400);
        if (maxPlace > capacity) return json({ error: 'A prize place cannot exceed tournament capacity.' }, 400);
      }
      const response = await super.fetch(request);
      return this.createMoneyControl(response, definition);
    }

    const id = String(body.id ?? url.searchParams.get('id') ?? '');
    if (request.method === 'POST' && url.pathname === '/engine/register') {
      const control = await this.control(id);
      if (control?.entryFeeCents) return this.registerMoney(request, body, control);
    }

    const response = await super.fetch(request);
    if (id) await this.reconcile(id);
    if (request.method === 'GET' && url.pathname === '/engine/list') {
      for (const moneyId of (await this.moneyInternals().ctx.storage.get<string[]>(MONEY_INDEX)) ?? []) await this.reconcile(moneyId);
      return this.enrichResponse(response);
    }
    if (id && ['/engine/detail', '/engine/me', '/engine/check-in', '/engine/start', '/engine/advance', '/engine/cancel'].includes(url.pathname)) return this.enrichResponse(response, id);
    if (request.method === 'POST' && url.pathname === '/view-game') {
      const tournamentId = String(body.tournamentId ?? '');
      if (tournamentId) await this.reconcile(tournamentId);
    }
    return response;
  }

  override async alarm(): Promise<void> {
    await super.alarm();
    for (const id of (await this.moneyInternals().ctx.storage.get<string[]>(MONEY_INDEX)) ?? []) await this.reconcile(id);
  }
}
