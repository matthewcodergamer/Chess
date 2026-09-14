import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, reduceGameSession, type GameSessionModel } from '../../shared/gameSession.ts';

function startRoom(): GameSessionModel {
  let room = createGameSession({
    id: 'integration-room',
    state: 'LOBBY',
    clockMs: 5 * 60_000,
    incrementMs: 2_000,
    connectionStatus: 'CONNECTED',
    now: 1_000,
  });
  room = reduceGameSession(room, { type: 'TRANSITION', to: 'READY', at: 1_100 });
  room = reduceGameSession(room, { type: 'TRANSITION', to: 'COUNTDOWN', at: 1_200 });
  room = reduceGameSession(room, { type: 'SET_COUNTDOWN', remainingMs: 1_000, endsAt: 2_200, at: 1_200 });
  room = reduceGameSession(room, { type: 'COUNTDOWN_TICK', elapsedMs: 1_000, at: 2_200 });
  return room;
}

test('room creation reaches one canonical ACTIVE snapshot', () => {
  const room = startRoom();
  assert.equal(room.id, 'integration-room');
  assert.equal(room.state, 'ACTIVE');
  assert.equal(room.connection.status, 'CONNECTED');
  assert.equal(room.moveNumber, 0);
  assert.equal(room.clocks.whiteMs, 300_000);
  assert.equal(room.clocks.blackMs, 300_000);
});

test('simultaneous move submissions resolve to the first accepted move', () => {
  const room = startRoom();
  const accepted = reduceGameSession(room, {
    type: 'MOVE_COMMITTED', fen: 'fen-after-first', sideToMove: 'black', mover: 'white', san: 'e4', at: 3_000,
  });
  const raced = reduceGameSession(accepted, {
    type: 'MOVE_COMMITTED', fen: 'fen-after-race', sideToMove: 'white', mover: 'black', san: 'e5', at: 3_000,
  });
  assert.equal(raced, accepted);
  assert.equal(raced.fen, 'fen-after-first');
  assert.deepEqual(raced.movesSan, ['e4']);
  assert.equal(raced.pendingClockPress, 'white');
});

test('reconnect restores play without resetting elapsed clock origin', () => {
  let room = startRoom();
  const startedAt = room.clocks.startedAt;
  room = reduceGameSession(room, { type: 'SET_CONNECTION', status: 'DISCONNECTED', white: false, at: 10_000 });
  assert.equal(room.state, 'RECONNECTING');
  assert.equal(room.clocks.startedAt, startedAt);
  room = reduceGameSession(room, { type: 'SET_CONNECTION', status: 'CONNECTED', white: true, at: 14_000 });
  assert.equal(room.state, 'ACTIVE');
  assert.equal(room.clocks.startedAt, startedAt);
});

test('disconnected player can still flag because reconnect is not a pause', () => {
  let room = createGameSession({
    id: 'disconnect-timeout', state: 'ACTIVE', sideToMove: 'white', whiteClockMs: 1_500, blackClockMs: 60_000,
    clockMs: 60_000, clockStartedAt: 1_000, connectionStatus: 'CONNECTED', now: 1_000,
  });
  room = reduceGameSession(room, { type: 'SET_CONNECTION', status: 'DISCONNECTED', white: false, at: 1_200 });
  room = reduceGameSession(room, { type: 'CLOCK_TICK', elapsedMs: 1_600, at: 2_800 });
  assert.equal(room.state, 'TIMEOUT');
  assert.equal(room.winner, 'black');
  assert.equal(room.clocks.whiteMs, 0);
});
