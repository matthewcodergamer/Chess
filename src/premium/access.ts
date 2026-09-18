export const PREMIUM_3D_ENTITLEMENT_KEY = 'qqurz:premium3d-session-v1';
export const PREMIUM_3D_PAYMENT_URL = 'https://buy.stripe.com/test_dRm5kF3zt1yf1JXb6A14403';

export function premium3DReceipt(): string {
  try { return window.localStorage.getItem(PREMIUM_3D_ENTITLEMENT_KEY)?.trim() ?? ''; }
  catch { return ''; }
}

export function hasPremium3DReceipt(): boolean {
  return Boolean(premium3DReceipt());
}

export function grantPremium3DReceipt(sessionId?: string | null): string {
  const value = sessionId?.trim() || `stripe-paid-${Date.now()}`;
  try { window.localStorage.setItem(PREMIUM_3D_ENTITLEMENT_KEY, value); }
  catch { /* Storage can be blocked; the in-session unlock still proceeds. */ }
  return value;
}
