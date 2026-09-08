import { MULTIPLAYER_API, multiplayerConfigured } from '../multiplayer/client';

export type Tournament = {
  id: string;
  name: string;
  entryCents: number;
  prizeLabel: string;
  format: string;
  timeControl: string;
  seats: number;
  testOnly?: boolean;
};

export type TournamentCatalog = {
  tournaments: Tournament[];
  paymentMode: 'off' | 'test';
  paymentConfigured: boolean;
  premium3dPriceCents: number;
};

export const FALLBACK_TOURNAMENTS: Tournament[] = [
  { id: 'quick-1', name: 'QQURZ Quick Test', entryCents: 100, prizeLabel: 'Test event', format: 'Knockout', timeControl: '5+0', seats: 8, testOnly: true },
  { id: 'rapid-5', name: 'QQURZ Rapid Open', entryCents: 500, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 16, testOnly: true },
  { id: 'freestyle-10', name: 'Freestyle 960 Open', entryCents: 1000, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 32, testOnly: true },
  { id: 'founders-20', name: 'QQURZ Founders Prize Open', entryCents: 2000, prizeLabel: '$500 guaranteed prize fund', format: 'Knockout', timeControl: '10+0', seats: 32, testOnly: true },
];

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (!multiplayerConfigured) throw new Error('Connect the QQURZ Cloudflare backend first.');
  const response = await fetch(`${MULTIPLAYER_API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Server returned ${response.status}.`);
  return body;
}

export async function loadTournamentCatalog(): Promise<TournamentCatalog> {
  if (!multiplayerConfigured) {
    return { tournaments: FALLBACK_TOURNAMENTS, paymentMode: 'off', paymentConfigured: false, premium3dPriceCents: 499 };
  }
  return requestJson<TournamentCatalog>('/tournaments');
}

export async function createCheckout(itemId: string, kind: 'tournament' | 'premium3d'): Promise<string> {
  const result = await requestJson<{ url: string }>('/checkout', {
    method: 'POST',
    body: JSON.stringify({ itemId, kind }),
  });
  return result.url;
}

export async function verifyCheckout(sessionId: string): Promise<{ paid: boolean; itemId: string; kind: string }> {
  return requestJson(`/checkout/verify?session_id=${encodeURIComponent(sessionId)}`);
}
