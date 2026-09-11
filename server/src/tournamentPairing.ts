import { pair as pairSwiss, type CompletedRound, type Game as PairingGame, type Player as PairingPlayer } from '@echecs/swiss';
import { pair as pairRoundRobin } from '@echecs/round-robin';
import {
  type EnginePairing,
  type EngineRound,
  type EngineStanding,
  type EngineTournament,
  type Participant,
  isRoundComplete,
  randomChess960Position,
} from './tournamentEngineTypes';

function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function seedOrder(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    seeds = seeds.flatMap(seed => [seed, sum - seed]);
  }
  return seeds;
}

export function newPairing(round: number, board: number, whiteId: string, blackId: string): EnginePairing {
  return {
    id: `r${round}b${board}`,
    round,
    board,
    whiteId,
    blackId,
    roomCode: null,
    whiteSeatToken: null,
    blackSeatToken: null,
    positionId: -1,
    status: 'pending',
    result: null,
    winnerId: null,
    whiteScore: null,
    blackScore: null,
    launchedAt: null,
    completedAt: null,
    launchError: null,
    attempts: [],
  };
}

export function newBye(round: number, board: number, playerId: string): EnginePairing {
  return {
    ...newPairing(round, board, playerId, ''),
    blackId: null,
    status: 'bye',
    result: 'Pairing bye',
    winnerId: playerId,
    whiteScore: 1,
    blackScore: 0,
    completedAt: Date.now(),
  };
}

export function pairingRounds(tournament: EngineTournament): CompletedRound[] {
  return tournament.rounds.filter(isRoundComplete).map(round => {
    const games: PairingGame[] = [];
    const byes: CompletedRound['byes'] = [];
    for (const pairing of round.pairings) {
      if (pairing.status === 'bye') {
        byes.push({ player: pairing.whiteId, kind: 'pairing' });
        continue;
      }
      if (pairing.status !== 'verified' || !pairing.blackId || pairing.whiteScore === null) continue;
      games.push({
        white: pairing.whiteId,
        black: pairing.blackId,
        result: pairing.whiteScore === 1 ? 'white' : pairing.whiteScore === 0 ? 'black' : 'draw',
        rated: true,
      });
    }
    return { games, byes };
  });
}

function libraryPlayers(tournament: EngineTournament, players: Participant[]): PairingPlayer[] {
  const scores = scoreMap(tournament);
  const rankById = new Map(standingsFor(tournament).map(row => [row.participantId, row.rank]));
  return players.map((player, index) => ({
    id: player.id,
    rating: player.rating,
    points: scores.get(player.id) ?? 0,
    rank: rankById.get(player.id) ?? player.seed ?? index + 1,
    startingRank: player.seed ?? index + 1,
  }));
}

function swissPairings(tournament: EngineTournament, round: number, players: Participant[]): EnginePairing[] {
  const result = pairSwiss(libraryPlayers(tournament, players), pairingRounds(tournament), { expectedRounds: tournament.roundCount });
  const rows: EnginePairing[] = [];
  let board = 1;
  for (const pairing of result.games) rows.push(newPairing(round, board++, String(pairing.white), String(pairing.black)));
  for (const bye of result.byes) rows.push(newBye(round, board++, String(bye.player)));
  return rows;
}

function roundRobinPairings(tournament: EngineTournament, round: number, players: Participant[]): EnginePairing[] {
  if (players.length < 3 || players.length > 16) throw new RangeError('Round-robin tournaments require 3–16 checked-in players.');
  const result = pairRoundRobin(libraryPlayers(tournament, players), pairingRounds(tournament));
  const rows: EnginePairing[] = [];
  let board = 1;
  for (const pairing of result.games) rows.push(newPairing(round, board++, String(pairing.white), String(pairing.black)));
  for (const bye of result.byes) rows.push(newBye(round, board++, String(bye.player)));
  return rows;
}

function eliminationPairings(tournament: EngineTournament, round: number, players: Participant[]): EnginePairing[] {
  if (round === 1) {
    const size = nextPowerOfTwo(players.length);
    const bySeed = new Map(players.map(player => [player.seed ?? 0, player.id]));
    const slots = seedOrder(size).map(seed => bySeed.get(seed) ?? null);
    const rows: EnginePairing[] = [];
    let board = 1;
    for (let index = 0; index < slots.length; index += 2) {
      const white = slots[index];
      const black = slots[index + 1];
      if (!white && !black) continue;
      if (white && !black) rows.push(newBye(round, board++, white));
      else if (!white && black) rows.push(newBye(round, board++, black));
      else rows.push(newPairing(round, board++, white!, black!));
    }
    return rows;
  }
  const previous = tournament.rounds.find(value => value.number === round - 1);
  const winners = previous?.pairings.map(pairing => pairing.winnerId).filter((id): id is string => Boolean(id)) ?? [];
  const rows: EnginePairing[] = [];
  let board = 1;
  for (let index = 0; index < winners.length; index += 2) {
    const white = winners[index];
    const black = winners[index + 1] ?? null;
    rows.push(black ? newPairing(round, board++, white, black) : newBye(round, board++, white));
  }
  return rows;
}

export function makeRound(tournament: EngineTournament, number: number, players: Participant[]): EngineRound {
  const positionId = tournament.positionPolicy.mode === 'per_round'
    ? randomChess960Position()
    : tournament.positionPolicy.mode === 'fixed'
      ? tournament.positionPolicy.positionId
      : null;
  const pairings = tournament.format === 'swiss'
    ? swissPairings(tournament, number, players)
    : tournament.format === 'round_robin'
      ? roundRobinPairings(tournament, number, players)
      : eliminationPairings(tournament, number, players);
  return { number, status: 'pairing', positionId, pairings, startedAt: Date.now(), completedAt: null };
}

export function seedPlayers(tournament: EngineTournament): Participant[] {
  const players = Object.values(tournament.participants)
    .filter(player => player.status !== 'withdrawn' && (!tournament.checkInRules.required || player.checkedInAt !== null))
    .sort((a, b) => b.rating - a.rating || a.registeredAt - b.registeredAt || a.name.localeCompare(b.name));
  players.forEach((player, index) => {
    player.seed = index + 1;
    player.status = 'active';
  });
  return players;
}

export function scoreMap(tournament: EngineTournament): Map<string, number> {
  const score = new Map<string, number>();
  for (const id of Object.keys(tournament.participants)) score.set(id, 0);
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      if (pairing.status === 'bye') score.set(pairing.whiteId, (score.get(pairing.whiteId) ?? 0) + 1);
      else if (pairing.status === 'verified' && pairing.blackId && pairing.whiteScore !== null && pairing.blackScore !== null) {
        score.set(pairing.whiteId, (score.get(pairing.whiteId) ?? 0) + pairing.whiteScore);
        score.set(pairing.blackId, (score.get(pairing.blackId) ?? 0) + pairing.blackScore);
      }
    }
  }
  return score;
}

export function standingsFor(tournament: EngineTournament): EngineStanding[] {
  const scores = scoreMap(tournament);
  type Stats = {
    participantId: string;
    name: string;
    rating: number;
    seed: number | null;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    score: number;
    opponents: Array<{ id: string; points: number }>;
    playing: boolean;
  };
  const stats = new Map<string, Stats>();
  for (const participant of Object.values(tournament.participants)) {
    if (participant.status === 'withdrawn') continue;
    stats.set(participant.id, {
      participantId: participant.id,
      name: participant.name,
      rating: participant.rating,
      seed: participant.seed,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      score: scores.get(participant.id) ?? 0,
      opponents: [],
      playing: false,
    });
  }
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      const white = stats.get(pairing.whiteId);
      const black = pairing.blackId ? stats.get(pairing.blackId) : null;
      if (pairing.status === 'live' && white) white.playing = true;
      if (pairing.status === 'live' && black) black.playing = true;
      if (!white || pairing.status === 'bye') continue;
      if (pairing.status !== 'verified' || !black || pairing.whiteScore === null || pairing.blackScore === null) continue;
      white.games += 1;
      black.games += 1;
      white.opponents.push({ id: black.participantId, points: pairing.whiteScore });
      black.opponents.push({ id: white.participantId, points: pairing.blackScore });
      if (pairing.whiteScore === 1) { white.wins += 1; black.losses += 1; }
      else if (pairing.blackScore === 1) { black.wins += 1; white.losses += 1; }
      else { white.draws += 1; black.draws += 1; }
    }
  }
  const rows = [...stats.values()].map(entry => {
    const buchholz = entry.opponents.reduce((sum, opponent) => sum + (scores.get(opponent.id) ?? 0), 0);
    const sonnebornBerger = entry.opponents.reduce((sum, opponent) => sum + (scores.get(opponent.id) ?? 0) * opponent.points, 0);
    const directEncounter = entry.opponents.filter(opponent => (scores.get(opponent.id) ?? 0) === entry.score).reduce((sum, opponent) => sum + opponent.points, 0);
    const participant = tournament.participants[entry.participantId];
    const status: EngineStanding['status'] = tournament.status === 'completed'
      ? 'complete'
      : entry.playing
        ? 'playing'
        : participant?.status === 'eliminated'
          ? 'eliminated'
          : 'active';
    return { ...entry, buchholz, sonnebornBerger, directEncounter, status };
  });

  rows.sort((a, b) => {
    if (tournament.format === 'single_elimination') {
      const ar = tournament.participants[a.participantId]?.eliminatedRound ?? Number.MAX_SAFE_INTEGER;
      const br = tournament.participants[b.participantId]?.eliminatedRound ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return br - ar;
    }
    if (a.score !== b.score) return b.score - a.score;
    for (const rule of tournament.tieBreakRules) {
      const diff = rule === 'direct_encounter' ? b.directEncounter - a.directEncounter
        : rule === 'buchholz' ? b.buchholz - a.buchholz
        : rule === 'sonneborn_berger' ? b.sonnebornBerger - a.sonnebornBerger
        : rule === 'wins' ? b.wins - a.wins
        : rule === 'rating' ? b.rating - a.rating
        : (a.seed ?? 999999) - (b.seed ?? 999999);
      if (diff) return diff;
    }
    return a.name.localeCompare(b.name);
  });

  return rows.map(({ opponents: _opponents, playing: _playing, ...row }, index) => ({ ...row, rank: index + 1 }));
}

export function publicPairing(pairing: EnginePairing, tournament: EngineTournament) {
  const white = tournament.participants[pairing.whiteId];
  const black = pairing.blackId ? tournament.participants[pairing.blackId] : null;
  return {
    id: pairing.id,
    round: pairing.round,
    board: pairing.board,
    roomCode: pairing.roomCode,
    positionId: pairing.positionId,
    status: pairing.status,
    result: pairing.result,
    winnerId: pairing.winnerId,
    launchedAt: pairing.launchedAt,
    completedAt: pairing.completedAt,
    white: white ? { id: white.id, name: white.name, rating: white.rating, seed: white.seed } : null,
    black: black ? { id: black.id, name: black.name, rating: black.rating, seed: black.seed } : null,
    attempts: pairing.attempts.map(attempt => ({ roomCode: attempt.roomCode, positionId: attempt.positionId, result: attempt.result, winnerId: attempt.winnerId, completedAt: attempt.completedAt })),
  };
}

export function scoreFromWinner(winner: 'white' | 'black' | null): { white: 0 | 0.5 | 1; black: 0 | 0.5 | 1 } {
  if (winner === 'white') return { white: 1, black: 0 };
  if (winner === 'black') return { white: 0, black: 1 };
  return { white: 0.5, black: 0.5 };
}

export { isRoundComplete };
