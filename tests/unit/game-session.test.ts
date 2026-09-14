import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clockOwner,
  createGameSession,
  reduceGameSession,
} from '../../shared/gameSession.ts';

test('countdown enters ACTIVE and starts the authoritative clock', () => {
  const session = createGameSession({ state: 'COUNTDOWN', countdownMs: 1_000, clockMs: 60_000, now: 100 });
  const active = reduceGameSession(session, { type: 'COUNTDOWN_TICK', elapsedMs: 1_000, at: 1_100 });
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.countdownMs, 0);
  assert.equal(active.clocks.startedAt, 1_100);
  assert.equal(clockOwner(active), 'white');
});

test('move commit requires a clock press and rejects a simultaneous second move', () => {
  const active = createGameSession({ state: 'ACTIVE', sideToMove: 'white', clockMs: 60_000, incrementMs: 2_000, clockStartedAt: 100, now: 100 });
  const first = reduceGameSession(active, {
    type: 'MOVE_COMMITTED',
    fen: 'after-white',
    sideToMove: 'black',
    mover: 'white',
    san: 'e4',
    at: 2_000,
  });
  assert.equal(first.moveNumber, 1);
  assert.equal(first.pendingClockPress, 'white');
  assert.equal(clockOwner(first), 'white');

  const simultaneous = reduceGameSession(first, {
    type: 'MOVE_COMMITTED',
    fen: 'illegal-second-state',
    sideToMove: 'white',
    mover: 'black',
    san: 'e5',
    at: 2_001,
  });
  assert.equal(simultaneous, first, 'a second move cannot land before the pending clock transfer');

  const transferred = reduceGameSession(first, { type: 'CLOCK_TRANSFERRED', at: 2_100 });
  assert.equal(transferred.pendingClockPress, null);
  assert.equal(transferred.clocks.whiteMs, 62_000, 'increment belongs to the mover after the clock press');
  assert.equal(clockOwner(transferred), 'black');
});

test('timeout ends the game and awards the opponent', () => {
  const active = createGameSession({ state: 'ACTIVE', sideToMove: 'white', clockMs: 900, clockStartedAt: 100, now: 100 });
  const ended = reduceGameSession(active, { type: 'CLOCK_TICK', elapsedMs: 1_000, at: 1_100 });
  assert.equal(ended.state, 'TIMEOUT');
  assert.equal(ended.clocks.whiteMs, 0);
  assert.equal(ended.winner, 'black');
  assert.equal(ended.resultKind, 'TIMEOUT');
});

test('disconnect and reconnect preserve the running clock origin', () => {
  const active = createGameSession({
    state: 'ACTIVE',
    sideToMove: 'black',
    clockMs: 300_000,
    clockStartedAt: 1_000,
    connectionStatus: 'CONNECTED',
    now: 1_000,
  });
  const disconnected = reduceGameSession(active, {
    type: 'SET_CONNECTION',
    status: 'DISCONNECTED',
    black: false,
    at: 5_000,
  });
  assert.equal(disconnected.state, 'RECONNECTING');
  assert.equal(disconnected.clocks.startedAt, 1_000, 'disconnect must not pause or restart the authoritative clock');

  const reconnected = reduceGameSession(disconnected, {
    type: 'SET_CONNECTION',
    status: 'CONNECTED',
    black: true,
    at: 8_000,
  });
  assert.equal(reconnected.state, 'ACTIVE');
  assert.equal(reconnected.clocks.startedAt, 1_000, 'reconnect must not manufacture extra time');
  assert.equal(reconnected.connection.black, true);
});

test('invalid state transitions fail loudly', () => {
  const lobby = createGameSession({ state: 'LOBBY', now: 1 });
  assert.throws(
    () => reduceGameSession(lobby, { type: 'TRANSITION', to: 'CHECKMATE', at: 2 }),
    /Invalid game-session transition/,
  );
});
