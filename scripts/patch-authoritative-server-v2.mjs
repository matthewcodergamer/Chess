import fs from 'node:fs';

const path = 'server/src/index.ts';
let source = fs.readFileSync(path, 'utf8');

if (source.includes("if (payload.type === 'offer_draw') return void await this.handleDrawOffer(ws, color);") && !/session\.state\s*=\s*'FINAL'/.test(source)) {
  console.log('Authoritative realtime command routing is already applied.');
  process.exit(0);
}

function required(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  source = source.replace(from, to);
}

required(
`    if (payload.type === 'start_now') {
      if (this.room.session.state !== 'COUNTDOWN' || !this.room.players.black) return this.sendError(ws, 'The game cannot start yet.');
      this.startPlaying(Date.now()); await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (payload.type === 'resign') {
      if (this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'There is no active game to resign.');
      this.settleActiveClock(Date.now()); this.room.session.state = 'FINAL'; this.room.session.result = \`${'${color === \'white\' ? \'Black\' : \'White\'}'} wins by resignation\`;
      this.room.session.pendingClockPress = null; this.room.session.clocks.startedAt = null; this.room.lastActivityAt = Date.now();
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.sendError(ws, 'Unknown command.');`,
`    if (payload.type === 'start_now') {
      if (this.room.session.state !== 'COUNTDOWN' || !this.room.players.black) return this.sendError(ws, 'The game cannot start yet.');
      this.startPlaying(Date.now()); await this.persist(); await this.scheduleForState(); this.broadcast(); return;
    }
    if (payload.type === 'offer_draw') return void await this.handleDrawOffer(ws, color);
    if (payload.type === 'accept_draw') return void await this.handleDrawAccept(ws, color);
    if (payload.type === 'decline_draw') return void await this.handleDrawDecline(ws, color);
    if (payload.type === 'resign') {
      if (!['ACTIVE', 'PAUSED', 'RECONNECTING'].includes(this.room.session.state)) return this.sendError(ws, 'There is no active game to resign.');
      const now = Date.now();
      if (this.room.session.state === 'ACTIVE') this.settleActiveClock(now);
      if (this.room.session.resultKind === 'TIMEOUT') {
        this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
      }
      this.room.session = reduceGameSession(this.room.session, { type: 'RESIGN', by: color, at: now });
      this.room.lastActivityAt = now;
      await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.sendError(ws, 'Unknown command.');`,
  'websocket lifecycle command routing',
);

required(
`  private async handleDrawOffer(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'Draw offers are only available during active play.');
    const other = opposite(color);
    const now = Date.now();
    if (this.room.session.drawOffers[other]) {
      this.room.session = reduceGameSession(this.room.session, { type: 'OFFER_DRAW', by: color, at: now });
      this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null, at: now });
      await this.ctx.storage.deleteAlarm();
    } else {
      this.room.session = reduceGameSession(this.room.session, { type: 'OFFER_DRAW', by: color, at: now });
    }
    this.room.lastActivityAt = now; await this.persist(); this.broadcast();
  }
  private async handleDrawAccept(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'There is no active draw offer.');
    const other = opposite(color);
    if (!this.room.session.drawOffers[other]) return this.sendError(ws, 'Your opponent has not offered a draw.');
    const now = Date.now();
    this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null, at: now });
    this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast();
  }`,
`  private async handleDrawOffer(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'Draw offers are only available during active play.');
    const other = opposite(color);
    const now = Date.now();
    if (this.room.session.drawOffers[other]) {
      this.settleActiveClock(now);
      if (this.room.session.resultKind === 'TIMEOUT') {
        this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
      }
      this.room.session = reduceGameSession(this.room.session, { type: 'OFFER_DRAW', by: color, at: now });
      this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null, at: now });
      await this.ctx.storage.deleteAlarm();
    } else {
      this.room.session = reduceGameSession(this.room.session, { type: 'OFFER_DRAW', by: color, at: now });
    }
    this.room.lastActivityAt = now; await this.persist(); this.broadcast();
  }
  private async handleDrawAccept(ws: WebSocket, color: Color): Promise<void> {
    if (!this.room || this.room.session.state !== 'ACTIVE') return this.sendError(ws, 'There is no active draw offer.');
    const other = opposite(color);
    if (!this.room.session.drawOffers[other]) return this.sendError(ws, 'Your opponent has not offered a draw.');
    const now = Date.now();
    this.settleActiveClock(now);
    if (this.room.session.resultKind === 'TIMEOUT') {
      this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast(); return;
    }
    this.room.session = reduceGameSession(this.room.session, { type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null, at: now });
    this.room.lastActivityAt = now; await this.persist(); await this.ctx.storage.deleteAlarm(); this.broadcast();
  }`,
  'draw settlement clock accounting',
);

if (/session\.state\s*=\s*'FINAL'/.test(source)) throw new Error('Direct FINAL state mutation remains in realtime command handling.');

fs.writeFileSync(path, source);
console.log('Realtime commands now route draw/resign outcomes through GameSession reducer.');
