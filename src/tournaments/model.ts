export const PLATFORM_RAKE_BPS = 2_000 as const;
export const REGULAR_TOURNAMENT_SEEDS = [16, 32, 64, 128, 256, 512, 1024, 2048] as const;
export const ANNUAL_CHAMPIONSHIP_SEATS = 4096 as const;
export const ANNUAL_CHAMPIONSHIP_ENTRY_CENTS = 50_000 as const;
export const ANNUAL_CHAMPIONSHIP_GUARANTEE_CENTS = 200_000_000 as const;
export const TOURNAMENT_SEEDS = [...REGULAR_TOURNAMENT_SEEDS, ANNUAL_CHAMPIONSHIP_SEATS] as const;
export const TOURNAMENT_ENTRY_CENTS = [1_000, 2_000, 5_000, 10_000, 50_000] as const;

export type TournamentSeed = (typeof TOURNAMENT_SEEDS)[number];
export type TournamentEntryCents = (typeof TOURNAMENT_ENTRY_CENTS)[number];
export type TournamentReadiness = 'open' | 'filling' | 'ready' | 'in_progress' | 'complete';

export type PayoutGroup = {
  label: string;
  fromPlace: number;
  toPlace: number;
  recipients: number;
  poolBps: number;
  groupCents: number;
  eachCents: number;
  bonusRecipients: number;
};

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
  platformRakeBps?: number;
  grossCents?: number;
  platformFeeCents?: number;
  prizePoolCents?: number;
  paidPlaces?: number;
  annualOnly?: boolean;
};

export function isAnnualChampionship(seats: number, entryCents: number): boolean {
  return seats === ANNUAL_CHAMPIONSHIP_SEATS && entryCents === ANNUAL_CHAMPIONSHIP_ENTRY_CENTS;
}

export function isTournamentCombinationAvailable(seats: number, entryCents: number): boolean {
  if (seats === ANNUAL_CHAMPIONSHIP_SEATS) return entryCents === ANNUAL_CHAMPIONSHIP_ENTRY_CENTS;
  return REGULAR_TOURNAMENT_SEEDS.includes(seats as (typeof REGULAR_TOURNAMENT_SEEDS)[number])
    && TOURNAMENT_ENTRY_CENTS.includes(entryCents as TournamentEntryCents);
}

export function tournamentId(seats: number, entryCents: number): string {
  return `knockout-${seats}-${entryCents}`;
}

export function tournamentName(seats: number, entryCents: number): string {
  if (isAnnualChampionship(seats, entryCents)) return 'QQURZ Chess Cup';
  return `QQURZ ${seats}-Seed ${entryCents >= 50_000 ? 'Championship' : entryCents >= 10_000 ? 'Major' : entryCents >= 5_000 ? 'Open' : 'Knockout'}`;
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

export function platformFeeCents(grossCents: number): number {
  return Math.floor((grossCents * PLATFORM_RAKE_BPS) / 10_000);
}

export function playerPrizePoolCents(grossCents: number): number {
  return grossCents - platformFeeCents(grossCents);
}

export function paidPlacesFor(seats: number): number {
  if (seats <= 32) return 4;
  if (seats === 64) return 8;
  return Math.max(16, Math.floor(seats / 8));
}

type PayoutSpec = { label: string; fromPlace: number; toPlace: number; poolBps: number };

function payoutSpecs(seats: number): PayoutSpec[] {
  const paidPlaces = paidPlacesFor(seats);
  if (paidPlaces <= 4) {
    return [
      { label: '1st', fromPlace: 1, toPlace: 1, poolBps: 5_000 },
      { label: '2nd', fromPlace: 2, toPlace: 2, poolBps: 2_500 },
      { label: '3rd', fromPlace: 3, toPlace: 3, poolBps: 1_500 },
      { label: '4th', fromPlace: 4, toPlace: 4, poolBps: 1_000 },
    ];
  }
  if (paidPlaces <= 8) {
    return [
      { label: '1st', fromPlace: 1, toPlace: 1, poolBps: 4_000 },
      { label: '2nd', fromPlace: 2, toPlace: 2, poolBps: 2_000 },
      { label: '3rd', fromPlace: 3, toPlace: 3, poolBps: 1_200 },
      { label: '4th', fromPlace: 4, toPlace: 4, poolBps: 800 },
      { label: '5th–8th', fromPlace: 5, toPlace: 8, poolBps: 2_000 },
    ];
  }
  return [
    { label: '1st', fromPlace: 1, toPlace: 1, poolBps: 3_500 },
    { label: '2nd', fromPlace: 2, toPlace: 2, poolBps: 1_800 },
    { label: '3rd', fromPlace: 3, toPlace: 3, poolBps: 1_000 },
    { label: '4th', fromPlace: 4, toPlace: 4, poolBps: 700 },
    { label: '5th–8th', fromPlace: 5, toPlace: 8, poolBps: 1_600 },
    { label: `9th–${paidPlaces}th`, fromPlace: 9, toPlace: paidPlaces, poolBps: 1_400 },
  ];
}

/**
 * Returns an exact-cent payout plan. Each percentage group is allocated first,
 * then split evenly; one-cent remainders go to the better placements.
 */
export function buildPayoutGroups(seats: number, prizePoolCents: number): PayoutGroup[] {
  const specs = payoutSpecs(seats);
  let allocated = 0;
  return specs.map((spec, index) => {
    const recipients = spec.toPlace - spec.fromPlace + 1;
    const groupCents = index === specs.length - 1
      ? Math.max(0, prizePoolCents - allocated)
      : Math.floor((prizePoolCents * spec.poolBps) / 10_000);
    allocated += groupCents;
    return {
      ...spec,
      recipients,
      groupCents,
      eachCents: Math.floor(groupCents / recipients),
      bonusRecipients: groupCents % recipients,
    };
  });
}

export function annualGuaranteeFundingGapCents(): number {
  const gross = registrationTotalCents(ANNUAL_CHAMPIONSHIP_SEATS, ANNUAL_CHAMPIONSHIP_ENTRY_CENTS);
  return Math.max(0, ANNUAL_CHAMPIONSHIP_GUARANTEE_CENTS - playerPrizePoolCents(gross));
}
