export type PaymentEnvironmentConfig = {
  deploymentEnv?: string;
  paymentsMode?: string;
  nuveiEnv?: string;
  realMoneyEnabled?: string;
};

export type PaymentEnvironmentDecision =
  | { allowed: true }
  | { allowed: false; message: string };

function normalized(value: unknown, fallback: string): string {
  const clean = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().toLowerCase().slice(0, 32);
  return clean || fallback;
}

export function isMoneyChangingPaymentRoute(pathname: string): boolean {
  return pathname === '/payments/deposit'
    || pathname === '/payments/withdrawal'
    || pathname === '/payments/premium/checkout'
    || pathname.startsWith('/payments/webhooks/');
}

export function decidePaymentEnvironment(
  config: PaymentEnvironmentConfig,
  pathname: string,
): PaymentEnvironmentDecision {
  if (!isMoneyChangingPaymentRoute(pathname)) return { allowed: true };

  const deployment = normalized(config.deploymentEnv, 'development');
  const paymentsMode = normalized(config.paymentsMode, 'disabled');
  const nuveiMode = normalized(config.nuveiEnv, 'disabled');
  const realMoneyEnabled = normalized(config.realMoneyEnabled, 'disabled');

  // Production is fail-closed. A test provider can never be exercised against
  // the production API, and live money requires an explicit reviewed launch.
  if (deployment === 'production') {
    if (paymentsMode !== 'live') return { allowed: false, message: 'Payments are disabled in production.' };
    if (nuveiMode === 'test') return { allowed: false, message: 'Test payment providers are forbidden in production.' };
    return { allowed: true };
  }

  // Development and staging are test-only. Accidentally supplying live provider
  // configuration is rejected even if a GitHub Environment is misconfigured.
  if (paymentsMode === 'live' || nuveiMode === 'live' || realMoneyEnabled === 'enabled') {
    return { allowed: false, message: 'Live money is forbidden outside production.' };
  }
  if (paymentsMode !== 'test') {
    return { allowed: false, message: 'Test payments are not enabled in this environment.' };
  }
  return { allowed: true };
}
