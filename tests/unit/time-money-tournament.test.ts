import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_CONTROL_PRESETS,
  createCustomTimeControl,
  isTournamentControlAllowed,
  normalizeTimeControl,
  ratingClassForTimeControl,
  tournamentTimeTemplateFor,
} from '../../shared/timeControl.ts';
import {
  basisPointsAmount,
  centsToUsdDecimal,
  usdDecimalToCents,
} from '../../shared/money.ts';
import {
  ANNUAL_CHAMPIONSHIP_ENTRY_CENTS,
  ANNUAL_CHAMPIONSHIP_SEATS,
  annualGuaranteeFundingGapCents,
  buildPayoutGroups,
  paidPlacesFor,
  platformFeeCents,
  playerPrizePoolCents,
  registrationTotalCents,
} from '../../src/tournaments/model.ts';

test('time controls normalize, clamp, and classify correctly', () => {
  assert.deepEqual(normalizeTimeControl('3+2'), TIME_CONTROL_PRESETS['3+2']);

  const custom = createCustomTimeControl(0, 999);
  assert.equal(custom.baseMs, 15_000);
  assert.equal(custom.incrementMs, 60_000);
  assert.equal(custom.custom, true);

  assert.equal(ratingClassForTimeControl(60_000, 0), 'bullet');
  assert.equal(ratingClassForTimeControl(3 * 60_000, 2_000), 'blitz');
  assert.equal(ratingClassForTimeControl(10 * 60_000, 5_000), 'rapid');
});

test('tournament time templates only accept configured controls', () => {
  const club = tournamentTimeTemplateFor(32, 1_000);
  assert.equal(club.id, 'club-blitz');
  assert.equal(isTournamentControlAllowed(club.id, TIME_CONTROL_PRESETS['3+2']), true);
  assert.equal(isTournamentControlAllowed(club.id, TIME_CONTROL_PRESETS['10+5']), false);

  const championship = tournamentTimeTemplateFor(4_096, 50_000);
  assert.equal(championship.id, 'championship');
  assert.equal(isTournamentControlAllowed(championship.id, TIME_CONTROL_PRESETS['10+5']), true);
});

test('money helpers preserve integer cents and exact basis-point math', () => {
  assert.equal(usdDecimalToCents('1234.56'), 123_456);
  assert.equal(centsToUsdDecimal(123_456), '1234.56');
  assert.equal(basisPointsAmount(12_345, 2_000), 2_469);
  assert.equal(basisPointsAmount(Number.MAX_SAFE_INTEGER, 10_000), Number.MAX_SAFE_INTEGER);
});

test('platform fee and prize pool always reconcile to gross', () => {
  for (const seats of [16, 32, 64, 128, 512, 2_048]) {
    for (const entry of [1_000, 2_000, 5_000, 10_000, 50_000]) {
      const gross = registrationTotalCents(seats, entry);
      const fee = platformFeeCents(gross);
      const pool = playerPrizePoolCents(gross);
      assert.equal(fee + pool, gross);
      assert.equal(fee, Math.floor(gross * 0.2));
    }
  }
});

test('payout curves distribute every cent exactly once', () => {
  for (const seats of [16, 32, 64, 128, 256, 1_024]) {
    for (const pool of [1, 101, 12_345, 204_800, 1_024_003]) {
      const groups = buildPayoutGroups(seats, pool);
      assert.equal(groups.reduce((sum, group) => sum + group.groupCents, 0), pool);
      assert.equal(groups.at(-1)?.toPlace, paidPlacesFor(seats));
      for (const group of groups) {
        assert.equal(group.eachCents * group.recipients + group.bonusRecipients, group.groupCents);
      }
    }
  }
});

test('annual championship guarantee exposes the exact operator funding gap', () => {
  const gross = registrationTotalCents(ANNUAL_CHAMPIONSHIP_SEATS, ANNUAL_CHAMPIONSHIP_ENTRY_CENTS);
  assert.equal(gross, 204_800_000);
  assert.equal(playerPrizePoolCents(gross), 163_840_000);
  assert.equal(annualGuaranteeFundingGapCents(), 36_160_000);
});
