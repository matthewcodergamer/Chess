import { MULTIPLAYER_API, multiplayerConfigured } from '../multiplayer/client';

export type TournamentViewPlayer = { name: string; rating: number | null };
export type TournamentViewGame = {
  tournamentId: string;
  roomCode: string;
  round: number;
  white: TournamentViewPlayer;
  black: TournamentViewPlayer;
  startedAt: number;
  updatedAt: number;
  status: 'live' | 'complete';
  result: string | null;
  winner: 'white' | 'black' | null;
};

export type TournamentStanding = {
  rank: number;
  name: string;
  rating: number | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  status: 'playing' | 'active' | 'eliminated';
};

export type TournamentLiveView = {
  tournamentId: string;
  games: TournamentViewGame[];
  standings: TournamentStanding[];
  liveGames: number;
  completedGames: number;
  updatedAt: number;
  serverNow: number;
};

export async function loadTournamentLiveView(tournamentId: string): Promise<TournamentLiveView> {
  if (!multiplayerConfigured) {
    return { tournamentId, games: [], standings: [], liveGames: 0, completedGames: 0, updatedAt: 0, serverNow: Date.now() };
  }
  const response = await fetch(`${MULTIPLAYER_API}/tournaments/${encodeURIComponent(tournamentId)}/live`, {
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({})) as TournamentLiveView & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Server returned ${response.status}.`);
  return payload;
}
