import { handlePaymentComplianceWebhook } from '../../paymentCompliance';
import { handleCanonicalPaymentRequest } from '../../data/paymentApiProjection';
import { CanonicalPaymentLedger as PaymentLedger } from '../../data/paymentProjection';
import { recordProviderWebhook } from '../../data/operations';
import type { DataModelEnv } from '../../data/registry';
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
export type PaymentsModuleEnv = PaymentApiEnv & ComplianceEnv & DataModelEnv;

export const paymentsModule = moduleDescriptor('payments-ledger', [
  'payment customers and provider intents',
  'wallet accounts and immutable ledger',
  'holds, contest settlement and platform fees',
  'payouts, withdrawals, refunds and premium entitlements',
  'KYC/compliance attestations and jurisdiction gates',
  'provider webhook outcome observability',
], ['auth', 'notifications']);

function clean(value: unknown, max = 180): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

async function recordComplianceOutcome(request: Request, response: Response, env: PaymentsModuleEnv, receivedAt: number): Promise<void> {
  const raw = await request.text().catch(() => '');
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
    metadata: { contentType: request.headers.get('content-type') ?? '' },
  });
}

export async function handlePaymentsRequest(request: Request, env: PaymentsModuleEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/payments/webhooks/compliance') {
    const receivedAt = Date.now();
    const copy = request.clone();
    const compliance = await handlePaymentComplianceWebhook(request, env);
    if (compliance) {
      await recordComplianceOutcome(copy, compliance, env, receivedAt).catch(() => undefined);
      return compliance;
    }
  } else {
    const compliance = await handlePaymentComplianceWebhook(request, env);
    if (compliance) return compliance;
  }
  return handleCanonicalPaymentRequest(request, env);
}
