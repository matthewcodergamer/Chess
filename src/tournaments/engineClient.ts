import { accountToken } from '../account/client';
import { MULTIPLAYER_API, multiplayerConfigured } from '../multiplayer/client';
import type { RoomSeat } from '../multiplayer/types';

export type EngineTournamentFormat = 'single_elimination' | 'swiss' | 'round_robin';
export type EngineTournamentStatus = 'registration' | 'check_in' | 'seeding' | 'round_active' | 'between_rounds' | 'completed' | 'cancelled';
export type EngineTieBreak = 'direct_encounter' | 'buchholz' | 'sonneborn_berger' | 'wins' | 'rating' | 'seed';

export type EngineTournamentSummary = {
  id: string;
  title: string;
  format: EngineTournamentFormat;
  capacity: number;
  startTime: number;
  roundCount: number;
  status: EngineTournamentStatus;
  currentRound: number;
  registered: number;
  checkedIn: number;
  createdAt: number;
  updatedAt: number;
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

export type EnginePairing = {
  id: string;
  round: number;
  board: number;
  roomCode: string | null;
  positionId: number;
  status: 'pending' | 'live' | 'verified' | 'bye' | 'launch_error';
  result: string | null;
  winnerId: string | null;
  launchedAt: number | null;
  completedAt: number | null;
  white: { id: string; name: string; rating: number; seed: number | null } | null;
  black: { id: string; name: string; rating: number; seed: number | null } | null;
  attempts: Array<{ roomCode: string; positionId: number; result: string | null; winnerId: string | null; completedAt: number | null }>;
};

export type EngineTournamentDetail = EngineTournamentSummary & {
  organizerName: string;
  entryRules: {
    mode: 'open' | 'invite';
    requiresVerifiedAccount: boolean;
    minRating: number | null;
    maxRating: number | null;
    registrationClosesBeforeStartMs: number;
  };
  checkInRules: { required: boolean; opensBeforeStartMs: number; closesAfterStartMs: number };
  timeControl: { id: string; label: string; baseMs: number; incrementMs: number; custom: boolean };
  positionPolicy: { mode: 'per_game' | 'per_round' | 'fixed'; positionId?: number };
  payout: { mode: 'none' | 'percent' | 'fixed'; currency: 'USD'; poolCents: number; places: Array<{ place: number; value: number }> };
  tieBreakRules: EngineTieBreak[];
  standings: EngineStanding[];
  participants: Array<{ id: string; name: string; rating: number; registeredAt: number; checkedInAt: number | null; seed: number | null; status: string }>;
  rounds: Array<{ number: number; status: 'pairing' | 'active' | 'complete'; positionId: number | null; startedAt: number; completedAt: number | null; pairings: EnginePairing[] }>;
  payoutLedger: Array<{ place: number; participantId: string; name: string; amountCents: number; currency: 'USD'; status: 'test_only' | 'ready_for_provider' }>;
  payoutStatus: 'not_applicable' | 'test_only' | 'ready_for_provider';
  cancellationReason: string | null;
  startedAt: number | null;
  completedAt: number | null;
  schedule: { registrationClosesAt: number; checkInOpensAt: number; checkInClosesAt: number; startDeadline: number };
  serverNow: number;
};

export type EngineTournamentDefinition = {
  title: string;
  format: EngineTournamentFormat;
  capacity: number;
  startTime: number;
  entryRules: {
    mode: 'open' | 'invite';
    inviteCode?: string;
    requiresVerifiedAccount: boolean;
    minRating?: number | null;
    maxRating?: number | null;
    registrationClosesBeforeStartMs: number;
  };
  checkInRules: { required: boolean; opensBeforeStartMs: number; closesAfterStartMs: number };
  timeControl: { baseMs: number; incrementMs: number };
  positionPolicy: { mode: 'per_game' | 'per_round' | 'fixed'; positionId?: number };
  payout: { mode: 'none' | 'percent' | 'fixed'; currency: 'USD'; poolCents: number; places: Array<{ place: number; value: number }> };
  roundCount: number;
  tieBreakRules: EngineTieBreak[];
};

export type EngineTournamentMe = {
  participant: { id: string; name: string; rating: number; checkedInAt: number | null; seed: number | null; status: string } | null;
  seat: RoomSeat | null;
  pairing: EnginePairing | null;
  tournament: EngineTournamentSummary;
  serverNow: number;
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!multiplayerConfigured) throw new Error('Connect the QQURZ realtime server first.');
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = accountToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${MULTIPLAYER_API}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Tournament server returned ${response.status}.`);
  return body;
}

export async function listEngineTournaments(): Promise<{ tournaments: EngineTournamentSummary[]; serverNow: number }> {
  return requestJson('/tournament-engine/tournaments');
}

export async function loadEngineTournament(id: string): Promise<EngineTournamentDetail> {
  return (await requestJson<{ tournament: EngineTournamentDetail }>(`/tournament-engine/tournaments/${encodeURIComponent(id)}`)).tournament;
}

export async function createEngineTournament(definition: EngineTournamentDefinition): Promise<EngineTournamentDetail> {
  return (await requestJson<{ tournament: EngineTournamentDetail }>('/tournament-engine/tournaments', { method: 'POST', body: JSON.stringify(definition) })).tournament;
}

export async function registerEngineTournament(id: string, inviteCode = ''): Promise<EngineTournamentDetail> {
  return (await requestJson<{ tournament: EngineTournamentDetail }>(`/tournament-engine/tournaments/${encodeURIComponent(id)}/register`, { method: 'POST', body: JSON.stringify({ inviteCode }) })).tournament;
}

export async function checkInEngineTournament(id: string): Promise<EngineTournamentDetail> {
  return (await requestJson<{ tournament: EngineTournamentDetail }>(`/tournament-engine/tournaments/${encodeURIComponent(id)}/check-in`, { method: 'POST', body: '{}' })).tournament;
}

export async function startEngineTournament(id: string): Promise<EngineTournamentDetail> {
  return (await requestJson<{ tournament: EngineTournamentDetail }>(`/tournament-engine/tournaments/${encodeURIComponent(id)}/start`, { method: 'POST', body: '{}' })).tournament;
}

export async function advanceEngineTournament(id: string): Promise<EngineTournamentDetail> {
  return (await requestJson<{ tournament: EngineTournamentDetail }>(`/tournament-engine/tournaments/${encodeURIComponent(id)}/advance`, { method: 'POST', body: '{}' })).tournament;
}

export async function cancelEngineTournament(id: string): Promise<EngineTournamentDetail> {
  return (await requestJson<{ tournament: EngineTournamentDetail }>(`/tournament-engine/tournaments/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' })).tournament;
}

export async function loadEngineTournamentMe(id: string): Promise<EngineTournamentMe> {
  return requestJson(`/tournament-engine/tournaments/${encodeURIComponent(id)}/me`);
}
