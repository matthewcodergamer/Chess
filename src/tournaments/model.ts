export const TOURNAMENT_SEEDS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096] as const;
export const TOURNAMENT_ENTRY_CENTS = [100, 500, 1000, 2000, 5000, 10000, 50000] as const;

export type TournamentSeed = (typeof TOURNAMENT_SEEDS)[number];
export type TournamentEntryCents = (typeof TOURNAMENT_ENTRY_CENTS)[number];
export type TournamentReadiness = 'open' | 'filling' | 'ready' | 'in_progress' | 'complete';

export type TournamentSelection = {
  id: string;
  name: string;
  seats: number;
  entryCents: number;
  registeredSeats?: number;
  status?: TournamentReadiness;
  timeControl: string;
  baseMinutes: number;
  incrementSeconds: number;
  format: string;
};

export function tournamentId(seats: number, entryCents: number): string {
  return `knockout-${seats}-${entryCents}`;
}

export function tournamentName(seats: number, entryCents: number): string {
  return `QQURZ ${seats}-Seed ${entryCents >= 50000 ? 'Championship' : entryCents >= 10000 ? 'Major' : entryCents >= 5000 ? 'Open' : 'Knockout'}`;
}

export function parseTimeControl(value: string): { baseMinutes: number; incrementSeconds: number } {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[+|]\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return { baseMinutes: 10, incrementSeconds: 0 };
  const baseMinutes = Math.max(.25, Math.min(180, Number(match[1])));
  const incrementSeconds = Math.max(0, Math.min(60, Number(match[2])));
  return { baseMinutes, incrementSeconds };
}

/** Chess.com-style effective game-time category using base + 40 increments. */
export function speedClass(baseMinutes: number, incrementSeconds: number): 'bullet' | 'blitz' | 'rapid' {
  const estimatedSeconds = baseMinutes * 60 + incrementSeconds * 40;
  if (estimatedSeconds < 180) return 'bullet';
  if (estimatedSeconds < 600) return 'blitz';
  return 'rapid';
}

export function firstMoveAllowanceSeconds(baseMinutes: number, incrementSeconds: number): number {
  const kind = speedClass(baseMinutes, incrementSeconds);
  return kind === 'bullet' ? 15 : kind === 'blitz' ? 20 : 60;
}

/** (B + 40i) × 10%, clamped to 30s–180s, where B is base time in seconds. */
export function disconnectAllowanceSeconds(baseMinutes: number, incrementSeconds: number): number {
  const baseSeconds = baseMinutes * 60;
  return Math.round(Math.max(30, Math.min(180, (baseSeconds + 40 * incrementSeconds) * .1)));
}

export function earlyMoveLimitSeconds(baseMinutes: number): number {
  return Math.round(baseMinutes * 60 * .5);
}

export function bracketRounds(seats: number): number {
  return Math.max(1, Math.round(Math.log2(Math.max(2, seats))));
}

export function roundLabel(index: number, totalRounds: number): string {
  const remaining = totalRounds - index;
  if (remaining === 1) return 'Final';
  if (remaining === 2) return 'Semifinals';
  if (remaining === 3) return 'Quarterfinals';
  return `Round of ${2 ** remaining}`;
}

export function registrationTotalCents(seats: number, entryCents: number): number {
  return seats * entryCents;
}
