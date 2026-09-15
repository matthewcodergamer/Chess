import { handlePaymentComplianceWebhook } from '../../paymentCompliance';
import { handleCanonicalPaymentRequest } from '../../data/paymentApiProjection';
import { CanonicalPaymentLedger as PaymentLedger } from '../../data/paymentProjection';
import { recordProviderWebhook } from '../../data/operations';
import type { DataModelEnv } from '../../data/registry';
import { decidePaymentEnvironment } from '../../paymentEnvironment';
import { moduleDescriptor } from '../contracts';

export {
  holdCompetitionFunds,
  releaseCompetitionHold,
  settleCompetitionFunds,
} from '../../paymentApi';
export * from '../../paymentPolicy';
export { PaymentLedger };

type PaymentApiEnv = Parameters<typeof handleCanonicalPaymentRequest>[1];
type ComplianceEnv = Parameters<typeof handlePaymentComplianceWebhook>[1];
export type PaymentsModuleEnv = PaymentApiEnv & ComplianceEnv & DataModelEnv & {
  DEPLOYMENT_ENV?: string;
  PAYMENTS_MODE?: string;
  NUVEI_ENV?: string;
  REAL_MONEY_ENABLED?: string;
};

export const paymentsModule = moduleDescriptor('payments-ledger', [
  'payment customers and provider intents',
  'wallet accounts and immutable ledger',
  'holds, contest settlement and platform fees',
  'payouts, withdrawals, refunds and premium entitlements',
  'KYC/compliance attestations and jurisdiction gates',
  'provider webhook outcome observability',
  'strict development/staging/production payment isolation',
], ['auth', 'notifications']);

function clean(value: unknown, max = 180): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function environmentPaymentGuard(request: Request, env: PaymentsModuleEnv): Response | null {
  const decision = decidePaymentEnvironment({
    deploymentEnv: env.DEPLOYMENT_ENV,
    paymentsMode: env.PAYMENTS_MODE,
    nuveiEnv: env.NUVEI_ENV,
    realMoneyEnabled: env.REAL_MONEY_ENABLED,
  }, new URL(request.url).pathname);
  return decision.allowed ? null : json({ error: decision.message }, 503);
}

async function recordComplianceOutcome(raw: string, contentType: string, response: Response, env: PaymentsModuleEnv, receivedAt: number): Promise<void> {
  let eventId = '';
  try {
    const payload = JSON.parse(raw) as { eventId?: unknown };
    eventId = clean(payload.eventId, 160);
  } catch {
    eventId = '';
  }
  const result = await response.clone().json().catch(() => ({})) as { error?: unknown };
  const error = clean(result.error, 500) || null;
  const status = response.ok ? 'processed' : response.status >= 500 ? 'failed' : 'rejected';
  const id = eventId ? `compliance:${eventId}` : `compliance:${crypto.randomUUID().replaceAll('-', '')}`;
  await recordProviderWebhook(env, {
    id,
    provider: 'compliance',
    endpoint: '/payments/webhooks/compliance',
    eventId: eventId || null,
    status,
    httpStatus: response.status,
    error,
    receivedAt,
    processedAt: Date.now(),
    metadata: { contentType },
  });
}

export async function handlePaymentsRequest(request: Request, env: PaymentsModuleEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/payments/')) return null;

  const guard = environmentPaymentGuard(request, env);
  if (guard) return guard;

  if (url.pathname === '/payments/webhooks/compliance') {
    const receivedAt = Date.now();
    const contentType = request.headers.get('content-type') ?? '';
    const raw = await request.clone().text().catch(() => '');
    const compliance = await handlePaymentComplianceWebhook(request, env);
    if (compliance) {
      await recordComplianceOutcome(raw, contentType, compliance, env, receivedAt).catch(() => undefined);
      return compliance;
    }
  } else {
    const compliance = await handlePaymentComplianceWebhook(request, env);
    if (compliance) return compliance;
  }
  return handleCanonicalPaymentRequest(request, env);
}
