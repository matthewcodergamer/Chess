import fs from 'node:fs';

const path = 'server/src/index.ts';
let source = fs.readFileSync(path, 'utf8');

source = source.replaceAll('session.sideToMoveStartedAt', 'session.clocks.startedAt');
source = source.replaceAll("this.room.session.state === 'TIMEOUT'", "this.room.session.resultKind === 'TIMEOUT'");

source = source.replace(
`  const connectedStatus = room.players.black && (!whiteConnected || !blackConnected) ? 'RECONNECTING' : 'CONNECTED';
  const effectiveState = room.session.state === 'ACTIVE' && connectedStatus === 'RECONNECTING' ? 'RECONNECTING' : room.session.state;
  const session: GameSessionModel = {
    ...room.session,
    state: effectiveState,
    clocks: { ...room.session.clocks, whiteMs: remainingFor(room, 'white', now), blackMs: remainingFor(room, 'black', now) },
    countdownMs: room.session.countdownEndsAt ? Math.max(0, room.session.countdownEndsAt - now) : room.session.countdownMs,
    connection: { status: connectedStatus, white: whiteConnected, black: blackConnected },
  };`,
`  const session: GameSessionModel = {
    ...room.session,
    clocks: { ...room.session.clocks, whiteMs: remainingFor(room, 'white', now), blackMs: remainingFor(room, 'black', now) },
    countdownMs: room.session.countdownEndsAt ? Math.max(0, room.session.countdownEndsAt - now) : room.session.countdownMs,
  };`,
);

source = source.replace(
"      this.ctx.acceptWebSocket(server); server.serializeAttachment({ token } satisfies SocketAttachment); this.sendSnapshot(server, token); queueMicrotask(() => { void this.syncConnectionState().then(() => this.broadcast()); });",
"      this.ctx.acceptWebSocket(server); server.serializeAttachment({ token } satisfies SocketAttachment); await this.syncConnectionState(); this.sendSnapshot(server, token); this.broadcast();",
);

source = source.replace(
`  private prepareCoin(now: number): void {
    if (!this.room) return;
    const current = this.room.session;
    this.room.session = createGameSession({
      id: current.id, state: 'COIN_TOSS', positionId: current.positionId, fen: current.fen, sideToMove: 'white',
      clockMs: GAME_CLOCK_MS, incrementMs: GAME_INCREMENT_MS, connectionStatus: 'CONNECTED', now,
    });
    this.room.coin = emptyCoin(); this.room.auction = emptyAuction(); this.room.colorAuction = emptyColorAuction(); this.room.lastActivityAt = now;
  }`,
`  private prepareCoin(now: number): void {
    if (!this.room) return;
    const current = this.room.session;
    let next = createGameSession({
      id: current.id, state: 'LOBBY', positionId: current.positionId, fen: current.fen, sideToMove: 'white',
      clockMs: GAME_CLOCK_MS, incrementMs: GAME_INCREMENT_MS, connectionStatus: 'CONNECTED', now,
    });
    next = reduceGameSession(next, { type: 'TRANSITION', to: 'READY', at: now });
    next = reduceGameSession(next, { type: 'TRANSITION', to: 'COIN_TOSS', at: now });
    this.room.session = next;
    this.room.coin = emptyCoin(); this.room.auction = emptyAuction(); this.room.colorAuction = emptyColorAuction(); this.room.lastActivityAt = now;
  }`,
);

if (source.includes('sideToMoveStartedAt')) throw new Error('Generated server still contains sideToMoveStartedAt.');

fs.writeFileSync(path, source);
console.log('Patched generated realtime session implementation.');
