import { handlePaymentComplianceWebhook } from '../../paymentCompliance';
import { handleCanonicalPaymentRequest } from '../../data/paymentApiProjection';
import { CanonicalPaymentLedger as PaymentLedger } from '../../data/paymentProjection';
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
], ['auth', 'notifications']);

export async function handlePaymentsRequest(request: Request, env: PaymentsModuleEnv): Promise<Response | null> {
  const compliance = await handlePaymentComplianceWebhook(request, env);
  if (compliance) return compliance;
  return handleCanonicalPaymentRequest(request, env);
}
