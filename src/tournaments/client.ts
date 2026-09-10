import { MULTIPLAYER_API, multiplayerConfigured } from '../multiplayer/client';
import {
  ANNUAL_CHAMPIONSHIP_ENTRY_CENTS,
  ANNUAL_CHAMPIONSHIP_GUARANTEE_CENTS,
  ANNUAL_CHAMPIONSHIP_SEATS,
  PLATFORM_RAKE_BPS,
  TOURNAMENT_ENTRY_CENTS,
  TOURNAMENT_SEEDS,
  annualGuaranteeFundingGapCents,
  bracketRounds,
  buildPayoutGroups,
  isAnnualChampionship,
  isTournamentCombinationAvailable,
  paidPlacesFor,
  platformFeeCents,
  playerPrizePoolCents,
  registrationTotalCents,
  tournamentId,
  tournamentName,
  type PayoutGroup,
  type TournamentReadiness,
} from './model';

export type PaymentMode = 'off' | 'test' | 'live';
export type CheckoutKind = 'tournament' | 'premium3d' | 'position_bid' | 'color_bid';

export type Tournament = {
  id: string;
  name: string;
  entryCents: number;
  prizeLabel: string;
  format: string;
  timeControl: string;
  baseMinutes: number;
  incrementSeconds: number;
  seats: number;
  rounds: number;
  registeredSeats: number;
  status: TournamentReadiness;
  fullRegistrationCents: number;
  grossCents: number;
  platformRakeBps: number;
  platformFeeCents: number;
  prizePoolCents: number;
  paidPlaces: number;
  payoutGroups: PayoutGroup[];
  annualOnly: boolean;
  registrationOpen: boolean;
  guaranteedPrizeCents?: number;
  guaranteeFundingGapCents?: number;
  currentGrossCents?: number;
  currentPlatformFeeCents?: number;
  currentPrizePoolCents?: number;
  testOnly?: boolean;
};

export type TournamentCatalog = {
  tournaments: Tournament[];
  paymentMode: PaymentMode;
  paymentConfigured: boolean;
  liveTournamentPaymentsEnabled?: boolean;
  cashTournamentCheckoutMode?: 'test-only' | 'approved-provider';
  complianceNotice?: string;
  platformRakeBps?: number;
  premium3dPriceCents: number;
  positionBidCents?: number[];
  livePositionBidsEnabled?: boolean;
  colorBidCents?: number[];
  liveColorBidsEnabled?: boolean;
};

function fallbackTournament(seats: number, entryCents: number): Tournament {
  const grossCents = registrationTotalCents(seats, entryCents);
  const feeCents = platformFeeCents(grossCents);
  const prizePoolCents = playerPrizePoolCents(grossCents);
  const annualOnly = isAnnualChampionship(seats, entryCents);
  return {
    id: tournamentId(seats, entryCents),
    name: tournamentName(seats, entryCents),
    entryCents,
    prizeLabel: annualOnly ? '$2,000,000 guarantee requires operator or sponsor funding' : '80% of collected entries allocated to the player prize pool',
    format: 'Single elimination',
    timeControl: '10+0',
    baseMinutes: 10,
    incrementSeconds: 0,
    seats,
    rounds: bracketRounds(seats),
    registeredSeats: 0,
    status: 'open',
    fullRegistrationCents: grossCents,
    grossCents,
    platformRakeBps: PLATFORM_RAKE_BPS,
    platformFeeCents: feeCents,
    prizePoolCents,
    paidPlaces: paidPlacesFor(seats),
    payoutGroups: buildPayoutGroups(seats, prizePoolCents),
    annualOnly,
    registrationOpen: !annualOnly,
    guaranteedPrizeCents: annualOnly ? ANNUAL_CHAMPIONSHIP_GUARANTEE_CENTS : undefined,
    guaranteeFundingGapCents: annualOnly ? annualGuaranteeFundingGapCents() : undefined,
    currentGrossCents: 0,
    currentPlatformFeeCents: 0,
    currentPrizePoolCents: 0,
    testOnly: true,
  };
}

export const FALLBACK_TOURNAMENTS: Tournament[] = TOURNAMENT_ENTRY_CENTS.flatMap(entryCents =>
  TOURNAMENT_SEEDS
    .filter(seats => isTournamentCombinationAvailable(seats, entryCents))
    .map(seats => fallbackTournament(seats, entryCents)),
);

if (!FALLBACK_TOURNAMENTS.some(event => event.seats === ANNUAL_CHAMPIONSHIP_SEATS && event.entryCents === ANNUAL_CHAMPIONSHIP_ENTRY_CENTS)) {
  FALLBACK_TOURNAMENTS.push(fallbackTournament(ANNUAL_CHAMPIONSHIP_SEATS, ANNUAL_CHAMPIONSHIP_ENTRY_CENTS));
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (!multiplayerConfigured) throw new Error('Connect the QQURZ Cloudflare backend first.');
  const response = await fetch(`${MULTIPLAYER_API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Server returned ${response.status}.`);
  return body;
}

export async function loadTournamentCatalog(): Promise<TournamentCatalog> {
  if (!multiplayerConfigured) {
    return {
      tournaments: FALLBACK_TOURNAMENTS,
      paymentMode: 'off',
      paymentConfigured: false,
      liveTournamentPaymentsEnabled: false,
      cashTournamentCheckoutMode: 'test-only',
      complianceNotice: 'Cash-prize tournament checkout is test-only until QQURZ has an approved payment provider and jurisdiction review.',
      platformRakeBps: PLATFORM_RAKE_BPS,
      premium3dPriceCents: 499,
      positionBidCents: [200, 500],
      livePositionBidsEnabled: false,
      colorBidCents: [200, 500],
      liveColorBidsEnabled: false,
    };
  }
  return requestJson<TournamentCatalog>('/tournaments');
}

export async function createCheckout(
  itemId: string,
  kind: CheckoutKind,
  context?: { roomCode?: string; desiredColor?: 'white' | 'black' },
): Promise<string> {
  const result = await requestJson<{ url: string }>('/checkout', {
    method: 'POST',
    body: JSON.stringify({ itemId, kind, roomCode: context?.roomCode, desiredColor: context?.desiredColor }),
  });
  return result.url;
}

export type VerifiedCheckout = {
  paid: boolean;
  itemId: string;
  kind: CheckoutKind | '';
  roomCode?: string;
  bidCents?: number;
  desiredColor?: 'white' | 'black' | '';
  paymentMode?: PaymentMode;
};

export async function verifyCheckout(sessionId: string): Promise<VerifiedCheckout> {
  return requestJson<VerifiedCheckout>(`/checkout/verify?session_id=${encodeURIComponent(sessionId)}`);
}

export type TournamentRegistrationResult = {
  eventId: string;
  registrationId: string;
  registeredSeats: number;
  seats: number;
  status: TournamentReadiness;
  alreadyRegistered: boolean;
  currentGrossCents?: number;
  currentPlatformFeeCents?: number;
  currentPrizePoolCents?: number;
};

export async function registerTournament(sessionId: string, playerName: string): Promise<TournamentRegistrationResult> {
  return requestJson<TournamentRegistrationResult>('/tournaments/register', {
    method: 'POST',
    body: JSON.stringify({ sessionId, playerName }),
  });
}
