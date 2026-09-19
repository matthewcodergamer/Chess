import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clockOwner,
  createGameSession,
  reduceGameSession,
  resultTextForViewer,
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


test('resignation result is shown as a color to the loser and You win to the winner', () => {
  const active = createGameSession({ state: 'ACTIVE', sideToMove: 'white', clockMs: 60_000, clockStartedAt: 100, now: 100 });
  const resigned = reduceGameSession(active, { type: 'RESIGN', by: 'white', at: 200 });
  assert.equal(resigned.result, 'Black wins');
  assert.equal(resigned.winner, 'black');
  assert.equal(resultTextForViewer(resigned, 'black'), 'You win');
  assert.equal(resultTextForViewer(resigned, 'white'), 'Black wins');
});

test('legacy resignation payloads still resolve You win for the winner', () => {
  const active = createGameSession({ state: 'ACTIVE', sideToMove: 'black', clockMs: 60_000, clockStartedAt: 100, now: 100 });
  const resigned = reduceGameSession(active, { type: 'RESIGN', by: 'black', at: 200 });
  const stripped = { ...resigned, winner: null, result: 'White wins by resignation' };
  assert.equal(resultTextForViewer(stripped, 'white'), 'You win');
  assert.equal(resultTextForViewer(stripped, 'black'), 'White wins');

  const textOnly = {
    ...resigned,
    winner: null,
    resignedBy: null,
    resultKind: 'OTHER' as const,
    result: 'Black wins by resignation',
  };
  assert.equal(resultTextForViewer(textOnly, 'black'), 'You win');
  assert.equal(resultTextForViewer(textOnly, 'white'), 'Black wins');
});

test('take-back pops the last ply and restores the fen', () => {
  const active = createGameSession({ state: 'ACTIVE', sideToMove: 'white', clockMs: 60_000, clockStartedAt: 100, now: 100 });
  const moved = reduceGameSession(active, {
    type: 'MOVE_COMMITTED',
    fen: 'after-white',
    sideToMove: 'black',
    mover: 'white',
    san: 'e4',
    at: 200,
  });
  const undone = reduceGameSession(moved, {
    type: 'TAKE_BACK',
    fen: 'start',
    sideToMove: 'white',
    plies: 1,
    at: 300,
  });
  assert.equal(undone.fen, 'start');
  assert.equal(undone.sideToMove, 'white');
  assert.equal(undone.moveNumber, 0);
  assert.equal(undone.movesSan.length, 0);
  assert.equal(undone.pendingClockPress, null);
});

test('checkmate and timeout results say You win to the winner', () => {
  const active = createGameSession({ state: 'ACTIVE', sideToMove: 'white', clockMs: 60_000, clockStartedAt: 100, now: 100 });
  const mate = reduceGameSession(active, {
    type: 'FINISH',
    kind: 'CHECKMATE',
    text: 'White wins by checkmate',
    winner: 'white',
    at: 200,
  });
  assert.equal(resultTextForViewer(mate, 'white'), 'You win');
  assert.equal(resultTextForViewer(mate, 'black'), 'White wins');

  const timed = reduceGameSession(active, { type: 'CLOCK_TICK', elapsedMs: 61_000, at: 61_100 });
  assert.equal(timed.winner, 'black');
  assert.equal(resultTextForViewer(timed, 'black'), 'You win');
  assert.equal(resultTextForViewer(timed, 'white'), 'Black wins');

  const draw = reduceGameSession(active, { type: 'FINISH', kind: 'DRAW', text: 'Draw by agreement', winner: null, at: 300 });
  assert.equal(resultTextForViewer(draw, 'white'), 'Draw by agreement');
});
