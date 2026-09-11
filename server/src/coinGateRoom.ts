import { TournamentChessRoom } from './tournamentRoom';

type SeatAttachment = { token?: unknown; role?: unknown };
type InternalRoom = {
  session: { state: string };
  players: { white: { token: string }; black: { token: string } | null };
  coin: { result: 'heads' | 'tails' | null };
  colorAuction: { leaderToken: string | null; usedSessions: string[] };
};
type GateState = { open: boolean; optedOut: string[] };

const GATE_KEY = 'color-toss-gate:v1';

function sendError(ws: WebSocket, message: string): void {
  try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* socket closing */ }
}

export class CoinGateChessRoom extends TournamentChessRoom {
  private gateInternals(): {
    room: InternalRoom | null;
    ctx: DurableObjectState;
    env: { STRIPE_SECRET_KEY?: string; PAYMENTS_MODE?: string; LIVE_COLOR_BIDS?: string };
  } {
    return this as unknown as {
      room: InternalRoom | null;
      ctx: DurableObjectState;
      env: { STRIPE_SECRET_KEY?: string; PAYMENTS_MODE?: string; LIVE_COLOR_BIDS?: string };
    };
  }

  private gateEnabled(): boolean {
    const { env } = this.gateInternals();
    const key = env.STRIPE_SECRET_KEY ?? '';
    if (env.PAYMENTS_MODE === 'test') return key.startsWith('sk_test_');
    return env.PAYMENTS_MODE === 'live' && key.startsWith('sk_live_') && env.LIVE_COLOR_BIDS === 'enabled';
  }

  private async gate(): Promise<GateState> {
    if (!this.gateEnabled()) return { open: true, optedOut: [] };
    return (await this.gateInternals().ctx.storage.get<GateState>(GATE_KEY)) ?? { open: false, optedOut: [] };
  }

  private async putGate(gate: GateState): Promise<void> {
    await this.gateInternals().ctx.storage.put(GATE_KEY, {
      open: Boolean(gate.open),
      optedOut: [...new Set(gate.optedOut)].slice(-2),
    } satisfies GateState);
  }

  private eventFor(token: string, gate: GateState) {
    const room = this.gateInternals().room;
    return {
      type: 'color_gate' as const,
      enabled: this.gateEnabled(),
      open: !this.gateEnabled() || gate.open,
      yourOptOut: gate.optedOut.includes(token),
      optedOut: gate.optedOut.length,
      required: room?.players.black ? 2 : 1,
    };
  }

  private async sendGate(ws: WebSocket, token: string): Promise<void> {
    try { ws.send(JSON.stringify(this.eventFor(token, await this.gate()))); } catch { /* socket closing */ }
  }

  private async broadcastGate(): Promise<void> {
    const gate = await this.gate();
    for (const ws of this.gateInternals().ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SeatAttachment | null;
      const token = typeof attachment?.token === 'string' ? attachment.token : null;
      if (!token || attachment?.role === 'spectator') continue;
      try { ws.send(JSON.stringify(this.eventFor(token, gate))); } catch { /* socket closing */ }
    }
  }

  private async chooseToss(ws: WebSocket, token: string): Promise<void> {
    const room = this.gateInternals().room;
    if (!room?.players.black || room.session.state !== 'COIN_TOSS' || room.coin.result) {
      sendError(ws, 'The color toss is not available right now.');
      return;
    }
    if (!this.gateEnabled()) {
      await this.putGate({ open: true, optedOut: [] });
      await this.sendGate(ws, token);
      return;
    }
    if (room.colorAuction.leaderToken) {
      sendError(ws, 'A color preference is already active and must be resolved before the toss.');
      return;
    }

    const gate = await this.gate();
    if (!gate.optedOut.includes(token)) gate.optedOut.push(token);
    const tokens = [room.players.white.token, room.players.black.token];
    gate.open = tokens.every(playerToken => gate.optedOut.includes(playerToken));
    await this.putGate(gate);
    await this.broadcastGate();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isJoin = url.hostname === 'room.internal' && url.pathname === '/join' && request.method === 'POST';
    const body = isJoin
      ? await request.clone().json().catch(() => ({})) as { tournamentDirectStart?: unknown }
      : null;
    const response = await super.fetch(request);
    if (isJoin && response.ok && body?.tournamentDirectStart !== true) {
      await this.putGate({ open: !this.gateEnabled(), optedOut: [] });
    }
    return response;
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let payload: Record<string, unknown> | null = null;
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      await super.webSocketMessage(ws, message);
      return;
    }

    const attachment = ws.deserializeAttachment() as SeatAttachment | null;
    const token = typeof attachment?.token === 'string' ? attachment.token : null;

    if (payload?.type === 'sync_request') {
      await super.webSocketMessage(ws, message);
      if (token && attachment?.role !== 'spectator') await this.sendGate(ws, token);
      return;
    }

    if (payload?.type === 'use_coin_toss') {
      if (!token || attachment?.role === 'spectator') {
        sendError(ws, 'A player seat is required.');
        return;
      }
      await this.chooseToss(ws, token);
      return;
    }

    if (payload?.type === 'call_coin' && this.gateEnabled()) {
      const gate = await this.gate();
      if (!gate.open) {
        sendError(ws, 'Resolve color preference first. If nobody wants a preference, both players can choose the free quarter toss.');
        return;
      }
    }

    if (payload?.type === 'claim_color_bid') {
      const room = this.gateInternals().room;
      const before = room?.colorAuction.usedSessions.length ?? 0;
      const previous = await this.gate();
      if (this.gateEnabled()) await this.putGate({ open: false, optedOut: [] });
      await super.webSocketMessage(ws, message);
      const after = this.gateInternals().room?.colorAuction.usedSessions.length ?? 0;
      if (this.gateEnabled() && after === before) await this.putGate(previous);
      await this.broadcastGate();
      return;
    }

    if (payload?.type === 'settle_color_bid') {
      await super.webSocketMessage(ws, message);
      await this.broadcastGate();
      return;
    }

    await super.webSocketMessage(ws, message);
  }
}
