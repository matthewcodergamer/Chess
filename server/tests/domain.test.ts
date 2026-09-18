import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlicko2Rating, rateGlicko2 } from '../src/rating.ts';
import { createTournamentDefinition, type Participant } from '../src/tournamentEngineTypes.ts';
import { makeRound, seedPlayers } from '../src/tournamentPairing.ts';
import { feePolicyForPurpose, platformFeeCents, verificationTierForPurpose } from '../src/paymentPolicy.ts';
import { createGameSession, reduceGameSession } from '../../shared/gameSession.ts';

function participant(id: string, rating: number, registeredAt: number): Participant {
  return {
    id,
    accountId: `account-${id}`,
    name: id,
    rating,
    ratingClass: 'rapid',
    registeredAt,
    checkedInAt: registeredAt,
    seed: null,
    status: 'checked_in',
    eliminatedRound: null,
  };
}

test('Glicko-2 winner gains rating and loser loses rating from the same pre-game snapshot', () => {
  const white = createGlicko2Rating(1500);
  const black = createGlicko2Rating(1500);
  const at = 1_700_000_000_000;
  const win = rateGlicko2(white, black, 1, at);
  const loss = rateGlicko2(black, white, 0, at);
  assert.ok(win.rating > 1500);
  assert.ok(loss.rating < 1500);
  assert.equal(win.games, 1);
  assert.equal(win.wins, 1);
  assert.equal(loss.losses, 1);
  assert.equal(win.lastRatedAt, at);
  assert.equal(loss.lastRatedAt, at);
});

test('equal Glicko-2 players drawing stay centered and update draw statistics', () => {
  const a = createGlicko2Rating(1500);
  const b = createGlicko2Rating(1500);
  const next = rateGlicko2(a, b, 0.5, 1_700_000_000_000);
  assert.equal(next.rating, 1500);
  assert.equal(next.draws, 1);
  assert.equal(next.games, 1);
  assert.ok(next.deviation < a.deviation);
});

test('Swiss first round pairs every checked-in player at most once', () => {
  const tournament = createTournamentDefinition({
    title: 'Automated Swiss Test',
    format: 'swiss',
    capacity: 6,
    startTime: Date.now() + 120_000,
    checkInRules: { required: true, opensBeforeStartMs: 1_800_000, closesAfterStartMs: 300_000 },
    timeControl: { baseMs: 300_000, incrementMs: 2_000 },
    positionPolicy: { mode: 'fixed', positionId: 518 },
    payout: { mode: 'none' },
  }, 'organizer', 'Organizer');

  const rows = [
    participant('p1', 1900, 1), participant('p2', 1800, 2), participant('p3', 1700, 3),
    participant('p4', 1600, 4), participant('p5', 1500, 5), participant('p6', 1400, 6),
  ];
  tournament.participants = Object.fromEntries(rows.map(row => [row.id, row]));
  const seeded = seedPlayers(tournament);
  const round = makeRound(tournament, 1, seeded);
  const ids = round.pairings.flatMap(pairing => pairing.blackId ? [pairing.whiteId, pairing.blackId] : [pairing.whiteId]);

  assert.equal(round.pairings.length, 3);
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual([...seeded].map(row => row.seed), [1, 2, 3, 4, 5, 6]);
});

test('Swiss odd field produces exactly one bye and no duplicate player', () => {
  const tournament = createTournamentDefinition({
    title: 'Odd Swiss Test',
    format: 'swiss',
    capacity: 5,
    startTime: Date.now() + 120_000,
    checkInRules: { required: false },
    positionPolicy: { mode: 'fixed', positionId: 518 },
    payout: { mode: 'none' },
  }, 'organizer', 'Organizer');
  const rows = [1, 2, 3, 4, 5].map(index => participant(`p${index}`, 2000 - index * 50, index));
  rows.forEach(row => { row.checkedInAt = null; });
  tournament.participants = Object.fromEntries(rows.map(row => [row.id, row]));
  const round = makeRound(tournament, 1, seedPlayers(tournament));
  const byes = round.pairings.filter(pairing => pairing.status === 'bye');
  const ids = round.pairings.flatMap(pairing => pairing.blackId ? [pairing.whiteId, pairing.blackId] : [pairing.whiteId]);
  assert.equal(byes.length, 1);
  assert.equal(new Set(ids).size, 5);
});

test('competition fee policy is fixed at 20% and refund verification is intentionally fee-free', () => {
  const friend = feePolicyForPurpose('friend_match_prize');
  const tournament = feePolicyForPurpose('tournament_prize');
  assert.equal(friend.platformFeeBps, 2_000);
  assert.equal(tournament.platformFeeBps, 2_000);
  assert.equal(platformFeeCents(12_345, tournament), 2_469);
  assert.equal(verificationTierForPurpose('refund'), 'none');
});

test('matched room becomes an active playable game only when both players connect', () => {
  const createdAt = 1_700_000_000_000;
  let session = createGameSession({
    id: 'room-smoke',
    state: 'READY',
    positionId: 518,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    clockMs: 600_000,
    incrementMs: 5_000,
    connectionStatus: 'DISCONNECTED',
    now: createdAt,
  });

  session = reduceGameSession(session, {
    type: 'SET_CONNECTION',
    status: 'CONNECTED',
    white: true,
    black: true,
    at: createdAt + 500,
  });

  assert.equal(session.state, 'READY');

  session = reduceGameSession(session, {
    type: 'TRANSITION',
    to: 'ACTIVE',
    at: createdAt + 500,
  });

  assert.equal(session.state, 'ACTIVE');
  assert.equal(session.clocks.startedAt, createdAt + 500);
  assert.equal(session.pendingClockPress, null);

  const next = reduceGameSession(session, {
    type: 'MOVE_COMMITTED',
    fen: session.fen,
    sideToMove: 'black',
    mover: 'white',
    san: 'e4',
    at: createdAt + 1_500,
  });

  assert.equal(next.moveNumber, 1);
  assert.equal(next.sideToMove, 'black');
  assert.equal(next.pendingClockPress, 'white');
});
