import { accountToken } from '../account/client';
import { MULTIPLAYER_API } from '../multiplayer/client';

export type WalletSnapshot = {
  accountId: string;
  currency: 'USD';
  availableCents: number;
  heldCents: number;
  pendingWithdrawalCents: number;
  debtCents: number;
  updatedAt: number;
  sequence: number;
};

export type CapabilityDecision = {
  allowed: boolean;
  jurisdiction: string;
  reason: string | null;
};

export type WalletEnvelope = {
  wallet: WalletSnapshot;
  compliance: {
    countryCode: string;
    regionCode: string;
    verifiedAge: number | null;
    identityVerified: boolean;
    ageVerified: boolean;
    taxProfileVerified: boolean;
  } | null;
  capabilities: {
    deposit: CapabilityDecision;
    friendMatch: CapabilityDecision;
    tournament: CapabilityDecision;
    withdrawal: CapabilityDecision;
  };
  entitlements: { premium3d: boolean; updatedAt: number };
};

async function requestJson<T>(path: string): Promise<T> {
  if (!MULTIPLAYER_API) throw new Error('The QQURZ payment server is not connected.');
  const headers = new Headers({ 'content-type': 'application/json' });
  const token = accountToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${MULTIPLAYER_API}${path}`, { headers });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Payment server returned ${response.status}.`);
  return payload;
}

export async function loadWallet(): Promise<WalletEnvelope> {
  return requestJson<WalletEnvelope>('/payments/wallet');
}
