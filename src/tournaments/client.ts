import { MULTIPLAYER_API, multiplayerConfigured } from '../multiplayer/client';
import {
  TOURNAMENT_ENTRY_CENTS,
  TOURNAMENT_SEEDS,
  bracketRounds,
  registrationTotalCents,
  tournamentId,
  tournamentName,
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
  testOnly?: boolean;
};

export type TournamentCatalog = {
  tournaments: Tournament[];
  paymentMode: PaymentMode;
  paymentConfigured: boolean;
  liveTournamentPaymentsEnabled?: boolean;
  premium3dPriceCents: number;
  positionBidCents?: number[];
  livePositionBidsEnabled?: boolean;
  colorBidCents?: number[];
  liveColorBidsEnabled?: boolean;
};

export const FALLBACK_TOURNAMENTS: Tournament[] = TOURNAMENT_ENTRY_CENTS.flatMap(entryCents =>
  TOURNAMENT_SEEDS.map(seats => ({
    id: tournamentId(seats, entryCents),
    name: tournamentName(seats, entryCents),
    entryCents,
    prizeLabel: 'Published prize schedule required before live launch',
    format: 'Single elimination',
    timeControl: '10+0',
    baseMinutes: 10,
    incrementSeconds: 0,
    seats,
    rounds: bracketRounds(seats),
    registeredSeats: 0,
    status: 'open' as const,
    fullRegistrationCents: registrationTotalCents(seats, entryCents),
    testOnly: true,
  })),
);

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
};

export async function registerTournament(sessionId: string, playerName: string): Promise<TournamentRegistrationResult> {
  return requestJson<TournamentRegistrationResult>('/tournaments/register', {
    method: 'POST',
    body: JSON.stringify({ sessionId, playerName }),
  });
}
