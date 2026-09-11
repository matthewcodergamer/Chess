import type { PaymentsEnv } from './paymentApi';

type LedgerStub = { fetch(request: Request): Promise<Response> };
type LedgerNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): LedgerStub };

type ComplianceEvent = {
  eventId?: unknown;
  accountId?: unknown;
  identityVerified?: unknown;
  ageVerified?: unknown;
  verifiedAge?: unknown;
  countryCode?: unknown;
  regionCode?: unknown;
  taxProfileVerified?: unknown;
  sanctionsChecked?: unknown;
  providerCustomerId?: unknown;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function clean(value: unknown, max = 180): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length || !/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function ledgerStub(env: PaymentsEnv): LedgerStub {
  const namespace = env.PAYMENTS as unknown as LedgerNamespace;
  return namespace.get(namespace.idFromName('qqurz-global-payment-ledger-v1'));
}

export async function handlePaymentComplianceWebhook(request: Request, env: PaymentsEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/payments/webhooks/compliance') return null;
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const secret = env.PAYMENTS_COMPLIANCE_WEBHOOK_SECRET ?? '';
  if (secret.length < 24) return json({ error: 'Compliance webhook verification is not configured.' }, 503);
  const timestamp = Number(request.headers.get('x-qqurz-compliance-timestamp') ?? '');
  const supplied = (request.headers.get('x-qqurz-compliance-signature') ?? '').trim().toLowerCase();
  const raw = await request.text();
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return json({ error: 'Stale compliance webhook.' }, 400);
  const expected = await hmacHex(secret, `${timestamp}.${raw}`);
  if (!constantTimeEqual(expected, supplied)) return json({ error: 'Invalid compliance webhook signature.' }, 400);

  let event: ComplianceEvent;
  try { event = JSON.parse(raw) as ComplianceEvent; }
  catch { return json({ error: 'Invalid compliance event.' }, 400); }
  const eventId = clean(event.eventId, 160);
  const accountId = clean(event.accountId, 80);
  const countryCode = clean(event.countryCode, 2).toUpperCase();
  const regionCode = clean(event.regionCode, 8).toUpperCase();
  const verifiedAge = Math.floor(Number(event.verifiedAge));
  if (!eventId || !accountId || !/^[A-Z]{2}$/.test(countryCode) || !Number.isFinite(verifiedAge) || verifiedAge < 0 || verifiedAge > 120) {
    return json({ error: 'Compliance event is missing required verified fields.' }, 400);
  }

  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-payments-internal', env.PAYMENTS_INTERNAL_SECRET ?? '');
  const response = await ledgerStub(env).fetch(new Request('https://payments.internal/internal/compliance', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      accountId,
      identityVerified: event.identityVerified === true,
      ageVerified: event.ageVerified === true,
      verifiedAge,
      countryCode,
      regionCode,
      taxProfileVerified: event.taxProfileVerified === true,
      sanctionsChecked: event.sanctionsChecked === true,
      providerCustomerId: clean(event.providerCustomerId, 180) || null,
      sourceEventId: eventId,
    }),
  }));
  const payload = await response.clone().json().catch(() => ({})) as { error?: string };
  return response.ok ? json({ received: true, eventId }) : json({ error: payload.error || 'Compliance profile update was rejected.' }, response.status);
}
