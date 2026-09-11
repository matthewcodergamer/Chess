import { accountToken } from '../account/client';
import { MULTIPLAYER_API } from '../multiplayer/client';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!MULTIPLAYER_API) throw new Error('The QQURZ payment server is not connected.');
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  });
  const token = accountToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${MULTIPLAYER_API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Payment server returned ${response.status}.`);
  return payload;
}

export async function openWalletDeposit(amountCents: number): Promise<void> {
  const result = await postJson<{ checkoutUrl: string }>('/payments/deposit', { amountCents });
  if (!result.checkoutUrl) throw new Error('The payment provider did not return a checkout URL.');
  location.assign(result.checkoutUrl);
}

export async function openPremiumCheckout(): Promise<void> {
  const result = await postJson<{ checkoutUrl: string }>('/payments/premium/checkout', {});
  if (!result.checkoutUrl) throw new Error('Stripe did not return a checkout URL.');
  location.assign(result.checkoutUrl);
}
