import {
  checkInCloseAt,
  checkInOpenAt,
  registrationCloseAt,
  startDeadline,
  tournamentIndexItem,
  type EngineTournament,
  type Participant,
  type PayoutLedgerItem,
} from './tournamentEngineTypes';
import { publicPairing, standingsFor } from './tournamentPairing';

export function publicParticipant(player: Participant) {
  return {
    id: player.id,
    name: player.name,
    rating: player.rating,
    registeredAt: player.registeredAt,
    checkedInAt: player.checkedInAt,
    seed: player.seed,
    status: player.status,
  };
}

export function buildPayoutLedger(tournament: EngineTournament, liveAllowed: boolean): { ledger: PayoutLedgerItem[]; status: EngineTournament['payoutStatus'] } {
  const standings = tournament.finalStandings ?? standingsFor(tournament);
  if (tournament.payout.mode === 'none' || !tournament.payout.places.length || !tournament.payout.poolCents) {
    return { ledger: [], status: 'not_applicable' };
  }
  const ledger = tournament.payout.places.flatMap(rule => {
    const standing = standings.find(row => row.rank === rule.place);
    if (!standing) return [];
    const amountCents = tournament.payout.mode === 'percent'
      ? Math.floor(tournament.payout.poolCents * rule.value / 10_000)
      : rule.value;
    return [{
      place: rule.place,
      participantId: standing.participantId,
      name: standing.name,
      amountCents,
      currency: 'USD' as const,
      status: liveAllowed ? 'ready_for_provider' as const : 'test_only' as const,
    }];
  });
  return { ledger, status: liveAllowed ? 'ready_for_provider' : 'test_only' };
}

export function tournamentDetail(tournament: EngineTournament) {
  return {
    ...tournamentIndexItem(tournament),
    organizerName: tournament.organizerName,
    entryRules: { ...tournament.entryRules, inviteCodeHash: undefined },
    checkInRules: tournament.checkInRules,
    timeControl: tournament.timeControl,
    positionPolicy: tournament.positionPolicy,
    payout: tournament.payout,
    tieBreakRules: tournament.tieBreakRules,
    standings: tournament.finalStandings ?? standingsFor(tournament),
    participants: Object.values(tournament.participants).map(publicParticipant),
    rounds: tournament.rounds.map(round => ({
      number: round.number,
      status: round.status,
      positionId: round.positionId,
      startedAt: round.startedAt,
      completedAt: round.completedAt,
      pairings: round.pairings.map(pairing => publicPairing(pairing, tournament)),
    })),
    payoutLedger: tournament.payoutLedger,
    payoutStatus: tournament.payoutStatus,
    cancellationReason: tournament.cancellationReason,
    startedAt: tournament.startedAt,
    completedAt: tournament.completedAt,
    schedule: {
      registrationClosesAt: registrationCloseAt(tournament),
      checkInOpensAt: checkInOpenAt(tournament),
      checkInClosesAt: checkInCloseAt(tournament),
      startDeadline: startDeadline(tournament),
    },
    serverNow: Date.now(),
  };
}
