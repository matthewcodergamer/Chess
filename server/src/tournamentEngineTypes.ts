import { normalizeTimeControl, type Chess960RatingClass, type TimeControl } from '../../shared/timeControl';

export type Color = 'white' | 'black';
export type TournamentFormat = 'single_elimination' | 'swiss' | 'round_robin';
export type TournamentEngineStatus = 'registration' | 'check_in' | 'seeding' | 'round_active' | 'between_rounds' | 'completed' | 'cancelled';
export type TournamentTieBreak = 'direct_encounter' | 'buchholz' | 'sonneborn_berger' | 'wins' | 'rating' | 'seed';
export type Chess960PositionPolicy =
  | { mode: 'per_game' }
  | { mode: 'per_round' }
  | { mode: 'fixed'; positionId: number };

export type TournamentEntryRules = {
  mode: 'open' | 'invite';
  inviteCodeHash: string | null;
  requiresVerifiedAccount: boolean;
  minRating: number | null;
  maxRating: number | null;
  registrationClosesBeforeStartMs: number;
};
export type TournamentCheckInRules = {
  required: boolean;
  opensBeforeStartMs: number;
  closesAfterStartMs: number;
};
export type TournamentPayoutDefinition = {
  mode: 'none' | 'percent' | 'fixed';
  currency: 'USD';
  poolCents: number;
  places: Array<{ place: number; value: number }>;
};
export type Participant = {
  id: string;
  accountId: string;
  name: string;
  rating: number;
  ratingClass: Chess960RatingClass;
  registeredAt: number;
  checkedInAt: number | null;
  seed: number | null;
  status: 'registered' | 'checked_in' | 'active' | 'eliminated' | 'withdrawn';
  eliminatedRound: number | null;
};
export type PairingAttempt = {
  roomCode: string;
  whiteId: string;
  blackId: string;
  positionId: number;
  result: string | null;
  winnerId: string | null;
  completedAt: number | null;
};
export type EnginePairing = {
  id: string;
  round: number;
  board: number;
  whiteId: string;
  blackId: string | null;
  roomCode: string | null;
  whiteSeatToken: string | null;
  blackSeatToken: string | null;
  positionId: number;
  status: 'pending' | 'live' | 'verified' | 'bye' | 'launch_error';
  result: string | null;
  winnerId: string | null;
  whiteScore: 0 | 0.5 | 1 | null;
  blackScore: 0 | 0.5 | 1 | null;
  launchedAt: number | null;
  completedAt: number | null;
  launchError: string | null;
  attempts: PairingAttempt[];
};
export type EngineRound = {
  number: number;
  status: 'pairing' | 'active' | 'complete';
  positionId: number | null;
  pairings: EnginePairing[];
  startedAt: number;
  completedAt: number | null;
};
export type EngineStanding = {
  rank: number;
  participantId: string;
  name: string;
  rating: number;
  seed: number | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  buchholz: number;
  sonnebornBerger: number;
  directEncounter: number;
  status: 'playing' | 'active' | 'eliminated' | 'complete';
};
export type PayoutLedgerItem = {
  place: number;
  participantId: string;
  name: string;
  amountCents: number;
  currency: 'USD';
  status: 'test_only' | 'ready_for_provider';
};
export type EngineTournament = {
  id: string;
  title: string;
  organizerAccountId: string;
  organizerName: string;
  format: TournamentFormat;
  capacity: number;
  startTime: number;
  entryRules: TournamentEntryRules;
  checkInRules: TournamentCheckInRules;
  timeControl: TimeControl;
  positionPolicy: Chess960PositionPolicy;
  payout: TournamentPayoutDefinition;
  roundCount: number;
  tieBreakRules: TournamentTieBreak[];
  status: TournamentEngineStatus;
  currentRound: number;
  participants: Record<string, Participant>;
  rounds: EngineRound[];
  finalStandings: EngineStanding[] | null;
  payoutLedger: PayoutLedgerItem[];
  payoutStatus: 'not_applicable' | 'test_only' | 'ready_for_provider';
  cancellationReason: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
};
export type TournamentIndexItem = Pick<EngineTournament, 'id' | 'title' | 'format' | 'capacity' | 'startTime' | 'roundCount' | 'status' | 'currentRound' | 'createdAt' | 'updatedAt'> & {
  registered: number;
  checkedIn: number;
};
export type Seat = { code: string; token: string; color: Color };

export const ENGINE_ID_PATTERN = /^event_[a-f0-9]{32}$/;
export const MAX_TOURNAMENT_CAPACITY = 4096;
export const MAX_TOURNAMENT_ROUNDS = 24;
export const DEFAULT_TIEBREAKS: TournamentTieBreak[] = ['buchholz', 'sonneborn_berger', 'wins', 'rating', 'seed'];

export function cleanTournamentTitle(value: unknown): string {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  return text || 'Untitled Chess960 Tournament';
}
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
export function nullableRating(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 100 && n <= 5000 ? Math.round(n) : null;
}
export function newTournamentId(): string { return `event_${crypto.randomUUID().replaceAll('-', '')}`; }
export function participantId(accountId: string): string { return `p_${accountId}`; }
export function randomChess960Position(): number {
  const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return bytes[0] % 960;
}
export function normalizedFormat(value: unknown): TournamentFormat {
  return value === 'swiss' || value === 'round_robin' ? value : 'single_elimination';
}
export function normalizedPositionPolicy(value: unknown): Chess960PositionPolicy {
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    if (source.mode === 'fixed') return { mode: 'fixed', positionId: clampInt(source.positionId, 0, 959, 518) };
    if (source.mode === 'per_round') return { mode: 'per_round' };
  }
  return { mode: 'per_game' };
}
export function normalizedTieBreaks(value: unknown, format: TournamentFormat): TournamentTieBreak[] {
  const allowed = new Set<TournamentTieBreak>(['direct_encounter', 'buchholz', 'sonneborn_berger', 'wins', 'rating', 'seed']);
  const input = Array.isArray(value) ? value.filter((item): item is TournamentTieBreak => typeof item === 'string' && allowed.has(item as TournamentTieBreak)) : [];
  const unique = [...new Set(input)];
  if (unique.length) return unique.slice(0, 6);
  if (format === 'round_robin') return ['direct_encounter', 'sonneborn_berger', 'wins', 'rating', 'seed'];
  return [...DEFAULT_TIEBREAKS];
}
export function normalizedPayout(value: unknown): TournamentPayoutDefinition {
  if (!value || typeof value !== 'object') return { mode: 'none', currency: 'USD', poolCents: 0, places: [] };
  const source = value as Record<string, unknown>;
  const mode: TournamentPayoutDefinition['mode'] = source.mode === 'percent' || source.mode === 'fixed' ? source.mode : 'none';
  if (mode === 'none') return { mode, currency: 'USD', poolCents: 0, places: [] };
  const poolCents = clampInt(source.poolCents, 0, 10_000_000_000, 0);
  const rawPlaces = Array.isArray(source.places) ? source.places : [];
  const places = rawPlaces.map(value => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return { place: clampInt(row.place, 1, 512, 1), value: clampInt(row.value, 0, mode === 'percent' ? 10_000 : poolCents, 0) };
  }).filter((row, index, all) => row.value > 0 && all.findIndex(other => other.place === row.place) === index).sort((a, b) => a.place - b.place).slice(0, 64);
  if (mode === 'percent' && places.reduce((sum, row) => sum + row.value, 0) > 10_000) throw new Error('Payout percentages cannot exceed 100%.');
  if (mode === 'fixed' && places.reduce((sum, row) => sum + row.value, 0) > poolCents) throw new Error('Fixed payouts cannot exceed the payout pool.');
  return { mode, currency: 'USD', poolCents, places };
}
export function eliminationRoundCount(capacity: number): number { return Math.max(1, Math.ceil(Math.log2(Math.max(2, capacity)))); }
export function roundRobinRoundCount(capacity: number): number { return capacity % 2 === 0 ? capacity - 1 : capacity; }
export function defaultSwissRounds(capacity: number): number { return Math.max(3, Math.min(MAX_TOURNAMENT_ROUNDS, Math.ceil(Math.log2(Math.max(4, capacity))) + 1)); }
export function normalizedRoundCount(format: TournamentFormat, capacity: number, value: unknown): number {
  if (format === 'single_elimination') return eliminationRoundCount(capacity);
  if (format === 'round_robin') return roundRobinRoundCount(capacity);
  return clampInt(value, 1, MAX_TOURNAMENT_ROUNDS, defaultSwissRounds(capacity));
}
export function registrationCloseAt(tournament: EngineTournament): number { return tournament.startTime - tournament.entryRules.registrationClosesBeforeStartMs; }
export function checkInOpenAt(tournament: EngineTournament): number { return tournament.startTime - tournament.checkInRules.opensBeforeStartMs; }
export function checkInCloseAt(tournament: EngineTournament): number { return tournament.startTime + tournament.checkInRules.closesAfterStartMs; }
export function startDeadline(tournament: EngineTournament): number { return tournament.checkInRules.required ? checkInCloseAt(tournament) : tournament.startTime; }
export function isRoundComplete(round: EngineRound): boolean { return round.pairings.every(pairing => pairing.status === 'verified' || pairing.status === 'bye'); }
export function pairingPosition(tournament: EngineTournament, round: EngineRound): number {
  if (tournament.positionPolicy.mode === 'fixed') return tournament.positionPolicy.positionId;
  if (tournament.positionPolicy.mode === 'per_round') return round.positionId ?? randomChess960Position();
  return randomChess960Position();
}
export function createTournamentDefinition(body: Record<string, unknown>, organizerAccountId: string, organizerName: string): EngineTournament {
  const now = Date.now();
  const format = normalizedFormat(body.format);
  const capacity = clampInt(body.capacity, 2, format === 'round_robin' ? 16 : MAX_TOURNAMENT_CAPACITY, format === 'round_robin' ? 8 : 32);
  const startTime = Math.max(now + 60_000, Number(body.startTime) || now + 30 * 60_000);
  const entry = body.entryRules && typeof body.entryRules === 'object' ? body.entryRules as Record<string, unknown> : {};
  const check = body.checkInRules && typeof body.checkInRules === 'object' ? body.checkInRules as Record<string, unknown> : {};
  const entryMode: TournamentEntryRules['mode'] = entry.mode === 'invite' ? 'invite' : 'open';
  return {
    id: newTournamentId(), title: cleanTournamentTitle(body.title), organizerAccountId, organizerName: cleanTournamentTitle(organizerName).slice(0, 40), format, capacity, startTime,
    entryRules: { mode: entryMode, inviteCodeHash: null, requiresVerifiedAccount: entry.requiresVerifiedAccount !== false, minRating: nullableRating(entry.minRating), maxRating: nullableRating(entry.maxRating), registrationClosesBeforeStartMs: clampInt(entry.registrationClosesBeforeStartMs, 0, 7 * 24 * 60 * 60_000, 0) },
    checkInRules: { required: check.required !== false, opensBeforeStartMs: clampInt(check.opensBeforeStartMs, 5 * 60_000, 24 * 60 * 60_000, 30 * 60_000), closesAfterStartMs: clampInt(check.closesAfterStartMs, 0, 60 * 60_000, 5 * 60_000) },
    timeControl: normalizeTimeControl(body.timeControl && typeof body.timeControl === 'object' ? body.timeControl as any : undefined, '10+5'), positionPolicy: normalizedPositionPolicy(body.positionPolicy), payout: normalizedPayout(body.payout), roundCount: normalizedRoundCount(format, capacity, body.roundCount), tieBreakRules: normalizedTieBreaks(body.tieBreakRules, format),
    status: 'registration', currentRound: 0, participants: {}, rounds: [], finalStandings: null, payoutLedger: [], payoutStatus: 'not_applicable', cancellationReason: null, createdAt: now, updatedAt: now, startedAt: null, completedAt: null,
  };
}
export async function hashInviteCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim()));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function tournamentIndexItem(tournament: EngineTournament): TournamentIndexItem {
  const players = Object.values(tournament.participants);
  return { id: tournament.id, title: tournament.title, format: tournament.format, capacity: tournament.capacity, startTime: tournament.startTime, roundCount: tournament.roundCount, status: tournament.status, currentRound: tournament.currentRound, createdAt: tournament.createdAt, updatedAt: tournament.updatedAt, registered: players.filter(player => player.status !== 'withdrawn').length, checkedIn: players.filter(player => player.checkedInAt !== null).length };
}
