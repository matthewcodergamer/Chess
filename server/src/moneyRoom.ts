import { CoinGateChessRoom } from './coinGateRoom';
import { holdCompetitionFunds, releaseCompetitionHold, settleCompetitionFunds, type PaymentsEnv } from './paymentApi';

type Color = 'white' | 'black';
type InternalRoom = {
  code: string;
  createdAt: number;
  session: { result: string | null; winner: Color | null };
  players: {
    white: { accountId: string | null; token: string };
    black: { accountId: string | null; token: string } | null;
  };
};

type MoneyMatchControl = {
  contestId: string;
  stakeCents: number;
  platformFeeBps: 2000;
  creatorAccountId: string;
  holdByAccount: Record<string, string>;
  status: 'awaiting_opponent' | 'funded' | 'settled' | 'released' | 'expired';
  expiresAt: number;
  settlementError: string | null;
  updatedAt: number;
};

const MONEY_CONTROL_KEY = 'money-match:v1';
const FUNDING_TTL_MS = 30 * 60_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function stakeCents(value: unknown): number {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount >= 100 && amount <= 100_000 ? amount : 0;
}

export class MoneyChessRoom extends CoinGateChessRoom {
  private moneyInternals(): { room: InternalRoom | null; ctx: DurableObjectState; env: PaymentsEnv } {
    return this as unknown as { room: InternalRoom | null; ctx: DurableObjectState; env: PaymentsEnv };
  }

  private async moneyControl(): Promise<MoneyMatchControl | null> {
    return (await this.moneyInternals().ctx.storage.get<MoneyMatchControl>(MONEY_CONTROL_KEY)) ?? null;
  }

  private async putControl(control: MoneyMatchControl): Promise<void> {
    control.updatedAt = Date.now();
    await this.moneyInternals().ctx.storage.put(MONEY_CONTROL_KEY, control);
  }

  private async createMoneyRoom(request: Request, body: Record<string, unknown>): Promise<Response> {
    const amount = stakeCents(body.stakeCents);
    if (!amount) return super.fetch(request);
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    const code = typeof body.code === 'string' ? body.code.toUpperCase() : '';
    if (!accountId) return json({ error: 'Sign in and complete money-play verification before creating a staked match.' }, 401);
    if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: 'Invalid room code.' }, 400);

    const contestId = `money-room:${code}`;
    const held = await holdCompetitionFunds(this.moneyInternals().env, {
      accountId,
      amountCents: amount,
      purpose: 'friend_match_entry',
      reference: contestId,
      idempotencyKey: `creator:${contestId}:${accountId}:${amount}`,
    });
    if (!held.ok || !held.holdId) return json({ error: held.error || 'The stake could not be reserved.' }, 403);

    const response = await super.fetch(request);
    if (!response.ok) {
      await releaseCompetitionHold(this.moneyInternals().env, { holdId: held.holdId, idempotencyKey: `create-failed:${contestId}` });
      return response;
    }

    const now = Date.now();
    await this.putControl({
      contestId,
      stakeCents: amount,
      platformFeeBps: 2000,
      creatorAccountId: accountId,
      holdByAccount: { [accountId]: held.holdId },
      status: 'awaiting_opponent',
      expiresAt: now + FUNDING_TTL_MS,
      settlementError: null,
      updatedAt: now,
    });
    await this.moneyInternals().ctx.storage.setAlarm(now + FUNDING_TTL_MS);
    return response;
  }

  private async joinMoneyRoom(request: Request, body: Record<string, unknown>, control: MoneyMatchControl): Promise<Response> {
    if (control.status !== 'awaiting_opponent') return super.fetch(request);
    if (control.expiresAt <= Date.now()) {
      await this.expireUnjoined(control);
      return json({ error: 'That staked match expired before a second player joined.' }, 410);
    }
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    if (!accountId) return json({ error: 'Sign in and complete money-play verification before joining a staked match.' }, 401);
    if (accountId === control.creatorAccountId) return json({ error: 'You cannot fund both sides of the same staked match.' }, 409);

    const held = await holdCompetitionFunds(this.moneyInternals().env, {
      accountId,
      amountCents: control.stakeCents,
      purpose: 'friend_match_entry',
      reference: control.contestId,
      idempotencyKey: `joiner:${control.contestId}:${accountId}:${control.stakeCents}`,
    });
    if (!held.ok || !held.holdId) return json({ error: held.error || 'The matching stake could not be reserved.' }, 403);

    const response = await super.fetch(request);
    if (!response.ok) {
      await releaseCompetitionHold(this.moneyInternals().env, { holdId: held.holdId, idempotencyKey: `join-failed:${control.contestId}:${accountId}` });
      return response;
    }
    control.holdByAccount[accountId] = held.holdId;
    control.status = 'funded';
    control.settlementError = null;
    await this.putControl(control);
    return response;
  }

  private async expireUnjoined(control: MoneyMatchControl): Promise<void> {
    if (control.status !== 'awaiting_opponent') return;
    const holdId = control.holdByAccount[control.creatorAccountId];
    if (holdId) await releaseCompetitionHold(this.moneyInternals().env, { holdId, idempotencyKey: `room-expired:${control.contestId}` });
    control.status = 'expired';
    control.settlementError = null;
    await this.putControl(control);
  }

  private async settleMoneyResult(): Promise<void> {
    const internal = this.moneyInternals();
    const room = internal.room;
    const control = await this.moneyControl();
    if (!room?.session.result || !control || control.status !== 'funded' || !room.players.black) return;
    const holdIds = Object.values(control.holdByAccount);
    if (holdIds.length !== 2) return;

    if (!room.session.winner) {
      await Promise.all(holdIds.map((holdId, index) => releaseCompetitionHold(internal.env, {
        holdId,
        idempotencyKey: `draw:${control.contestId}:${index}`,
      })));
      control.status = 'released';
      control.settlementError = null;
      await this.putControl(control);
      return;
    }

    const winner = room.session.winner === 'white' ? room.players.white : room.players.black;
    if (!winner?.accountId) {
      control.settlementError = 'Authoritative winner has no verified account id.';
      await this.putControl(control);
      return;
    }
    const settled = await settleCompetitionFunds(internal.env, {
      contestId: control.contestId,
      winnerAccountId: winner.accountId,
      holdIds,
      platformFeeBps: control.platformFeeBps,
      prizePurpose: 'friend_match_prize',
    });
    if (settled.ok) {
      control.status = 'settled';
      control.settlementError = null;
    } else {
      control.settlementError = settled.error || 'Money settlement failed and will be retried.';
    }
    await this.putControl(control);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const internalCreate = url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST';
    const internalJoin = url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST';
    if (internalCreate) {
      const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
      return this.createMoneyRoom(request, body);
    }
    if (internalJoin) {
      const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
      const control = await this.moneyControl();
      if (control?.stakeCents) return this.joinMoneyRoom(request, body, control);
    }
    return super.fetch(request);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await super.webSocketMessage(ws, message);
    await this.settleMoneyResult();
  }

  override async alarm(): Promise<void> {
    const control = await this.moneyControl();
    if (control?.status === 'awaiting_opponent' && control.expiresAt <= Date.now()) {
      await this.expireUnjoined(control);
      return;
    }
    await super.alarm();
    await this.settleMoneyResult();
  }
}
