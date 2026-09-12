export const PREMIUM_3D_ENTITLEMENT_KEY = 'qqurz:premium3d-session-v1';

export function premium3DReceipt(): string {
  try { return window.localStorage.getItem(PREMIUM_3D_ENTITLEMENT_KEY)?.trim() ?? ''; }
  catch { return ''; }
}

export function hasPremium3DReceipt(): boolean {
  return Boolean(premium3DReceipt());
}
