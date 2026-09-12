import { ACCOUNT_API, accountToken } from '../account/client';

export type FairPlayPolicy = {
  configured: boolean;
  accepted: boolean;
  version: string;
  acceptedAt: number | null;
  rules: string[];
  identity: { id: string; displayName: string } | null;
};

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!ACCOUNT_API) throw new Error('The QQURZ fair-play server is not connected.');
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  const token = accountToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${ACCOUNT_API}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new Error(payload.error || `Fair-play server returned ${response.status}.`);
  return payload;
}

export async function loadFairPlayPolicy(): Promise<FairPlayPolicy> {
  return requestJson<FairPlayPolicy>('/fair-play/policy');
}

export async function acceptFairPlayPolicy(): Promise<{ accepted: boolean; version: string; acceptedAt: number }> {
  return requestJson('/fair-play/accept', { method: 'POST', body: '{}' });
}
