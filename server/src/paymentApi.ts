import { handleAccountRequest, resolveAccountSession, type AccountEnv } from './accounts';
import { PaymentLedger, type PaymentLedgerEnv, type WalletSnapshot } from './paymentLedger';

type LedgerStub = { fetch(request: Request): Promise<Response> };
type LedgerNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): LedgerStub };

export type PaymentsEnv = AccountEnv & PaymentLedgerEnv & {
  PAYMENTS: DurableObjectNamespace<PaymentLedger>;
  PUBLIC_SITE_URL?: string;
  PAYMENTS_INTENT_SECRET?: string;
  REAL_MONEY_PROVIDER?: string;
  NUVEI_ENV?: string;
  NUVEI_MERCHANT_ID?: string;
  NUVEI_MERCHANT_SITE_ID?: string;
  NUVEI_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PREMIUM_3D_PRICE_CENTS?: string;
};

type AccountPaymentIdentity = {
  id: string;
  email: string;
  countryCode: string;
  displayName: string;
};

type WalletEnvelope = {
  wallet: WalletSnapshot;
  compliance: { countryCode: string; regionCode: string; verifiedAge: number | null; identityVerified: boolean; ageVerified: boolean; taxProfileVerified: boolean } | null;
  capabilities: Record<string, { allowed: boolean; reason: string | null; jurisdiction: string }>;
  entitlements: { premium3d: boolean; updatedAt: number };
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function clean(value: unknown, max = 180): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function parseCents(value: unknown, min = 100, max = 100_000): number {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount >= min && amount <= max ? amount : 0;
}

function ledgerStub(env: PaymentsEnv): LedgerStub {
  const namespace = env.PAYMENTS as unknown as LedgerNamespace;
  return namespace.get(namespace.idFromName('qqurz-global-payment-ledger-v1'));
}

function internalHeaders(env: PaymentsEnv): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-payments-internal', env.PAYMENTS_INTERNAL_SECRET ?? '');
  return headers;
}

async function ledgerJson<T>(env: PaymentsEnv, path: string, init: RequestInit = {}): Promise<{ response: Response; data: T & { error?: string } }> {
  const response = await ledgerStub(env).fetch(new Request(`https://payments.internal${path}`, init));
  const data = await response.clone().json().catch(() => ({})) as T & { error?: string };
  return { response, data };
}

async function authenticatedIdentity(request: Request, env: PaymentsEnv): Promise<AccountPaymentIdentity | null> {
  const session = await resolveAccountSession(request, env);
  if (!session) return null;
  const headers = new Headers();
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('user-agent', userAgent);
  const me = await handleAccountRequest(new Request('https://accounts.local/account/me', { headers }), env);
  if (!me?.ok) return null;
  const payload = await me.json().catch(() => ({})) as { account?: { id?: string; email?: string; countryCode?: string; displayName?: string } };
  if (!payload.account?.id || payload.account.id !== session.id) return null;
  return {
    id: session.id,
    email: clean(payload.account.email, 254),
    countryCode: clean(payload.account.countryCode, 2).toUpperCase(),
    displayName: clean(payload.account.displayName, 80) || session.displayName,
  };
}

async function walletFor(env: PaymentsEnv, accountId: string): Promise<WalletEnvelope> {
  const { response, data } = await ledgerJson<WalletEnvelope>(env, `/wallet/${encodeURIComponent(accountId)}`);
  if (!response.ok) throw new Error(data.error || 'Wallet unavailable.');
  return data;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return hex(new Uint8Array(signature));
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length || !/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function signedDepositIntent(env: PaymentsEnv, accountId: string, amountCents: number): Promise<string> {
  const secret = env.PAYMENTS_INTENT_SECRET ?? '';
  if (secret.length < 24) throw new Error('Payment intent signing is not configured.');
  const payload = `${accountId.replaceAll('-', '')}.${amountCents}.${Date.now() + 15 * 60_000}.${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const encoded = base64Url(payload);
  const signature = (await hmacHex(secret, encoded)).slice(0, 32);
  return `q1.${encoded}.${signature}`;
}

async function verifyDepositIntent(env: PaymentsEnv, token: string): Promise<{ accountId: string; amountCents: number } | null> {
  const secret = env.PAYMENTS_INTENT_SECRET ?? '';
  const match = /^q1\.([A-Za-z0-9_-]+)\.([a-f0-9]{32})$/i.exec(token);
  if (!match || secret.length < 24) return null;
  const expected = (await hmacHex(secret, match[1])).slice(0, 32);
  if (!constantTimeHexEqual(expected, match[2])) return null;
  try {
    const [rawAccount, rawAmount, rawExpiry] = fromBase64Url(match[1]).split('.');
    const accountId = rawAccount.length === 32 ? `${rawAccount.slice(0, 8)}-${rawAccount.slice(8, 12)}-${rawAccount.slice(12, 16)}-${rawAccount.slice(16, 20)}-${rawAccount.slice(20)}` : '';
    const amountCents = Math.floor(Number(rawAmount));
    const expiresAt = Number(rawExpiry);
    if (!accountId || !Number.isFinite(amountCents) || amountCents <= 0 || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
    return { accountId, amountCents };
  } catch {
    return null;
  }
}

function nuveiConfigured(env: PaymentsEnv): boolean {
  return env.REAL_MONEY_PROVIDER === 'nuvei'
    && Boolean(env.NUVEI_MERCHANT_ID)
    && Boolean(env.NUVEI_MERCHANT_SITE_ID)
    && Boolean(env.NUVEI_SECRET_KEY)
    && Boolean(env.PAYMENTS_INTENT_SECRET)
    && Boolean(env.PAYMENTS_INTERNAL_SECRET);
}

function utcTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}.${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

async function createNuveiDeposit(request: Request, env: PaymentsEnv, identity: AccountPaymentIdentity): Promise<Response> {
  if (!nuveiConfigured(env)) return json({ error: 'The approved real-money payment provider is not configured yet.' }, 503);
  const body = await request.json().catch(() => ({})) as { amountCents?: unknown };
  const amountCents = parseCents(body.amountCents, 500, 100_000);
  if (!amountCents) return json({ error: 'Deposit must be between $5 and $1,000.' }, 400);
  const wallet = await walletFor(env, identity.id);
  const capability = wallet.capabilities.deposit;
  if (!capability?.allowed) return json({ error: capability?.reason || 'Deposits are unavailable.', jurisdiction: capability?.jurisdiction ?? '' }, 403);
  if (!wallet.compliance?.countryCode || !identity.email) return json({ error: 'Verified country and email are required before funding.' }, 403);

  const intent = await signedDepositIntent(env, identity.id, amountCents);
  const total = (amountCents / 100).toFixed(2);
  const site = (env.PUBLIC_SITE_URL ?? 'https://qqurzchess.com').replace(/\/$/, '');
  const timestamp = utcTimestamp();
  const ordered: Array<[string, string]> = [
    ['merchant_id', env.NUVEI_MERCHANT_ID!],
    ['merchant_site_id', env.NUVEI_MERCHANT_SITE_ID!],
    ['user_token', 'auto'],
    ['user_token_id', identity.id],
    ['userid', identity.id],
    ['item_name_1', 'QQURZ Wallet Deposit'],
    ['item_number_1', intent],
    ['item_amount_1', total],
    ['item_quantity_1', '1'],
    ['numberofitems', '1'],
    ['total_amount', total],
    ['currency', 'USD'],
    ['version', '4.0.0'],
    ['encoding', 'UTF-8'],
    ['country', wallet.compliance.countryCode],
    ['email', identity.email],
    ['notify_url', `${site}/api/payments/webhooks/nuvei`],
    ['time_stamp', timestamp],
  ];
  const checksum = await sha256(`${env.NUVEI_SECRET_KEY}${ordered.map(([, value]) => value).join('')}`);
  const params = new URLSearchParams(ordered);
  params.set('checksum', checksum);
  const endpoint = env.NUVEI_ENV === 'live' ? 'https://secure.safecharge.com/ppp/purchase.do' : 'https://ppp-test.safecharge.com/ppp/purchase.do';
  return json({ provider: 'nuvei', method: 'GET', checkoutUrl: `${endpoint}?${params.toString()}`, amountCents, currency: 'USD', expiresInSeconds: 900 });
}

function stripeConfigured(env: PaymentsEnv): boolean {
  const key = env.STRIPE_SECRET_KEY ?? '';
  return key.startsWith('sk_test_') || key.startsWith('sk_live_');
}

async function createPremiumCheckout(request: Request, env: PaymentsEnv, identity: AccountPaymentIdentity): Promise<Response> {
  if (!stripeConfigured(env)) return json({ error: 'Stripe is not configured for premium purchases.' }, 503);
  const idempotency = clean(request.headers.get('idempotency-key'), 160);
  if (!idempotency) return json({ error: 'An Idempotency-Key header is required.' }, 400);
  const price = parseCents(env.PREMIUM_3D_PRICE_CENTS ?? '499', 50, 100_000) || 499;
  const site = (env.PUBLIC_SITE_URL ?? 'https://qqurzchess.com').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product_data][name]', 'QQURZ Premium 3D Board Pass');
  params.set('line_items[0][price_data][unit_amount]', String(price));
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${site}/?checkout=success&kind=premium3d&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${site}/?checkout=cancelled&kind=premium3d`);
  params.set('customer_email', identity.email);
  params.set('metadata[account_id]', identity.id);
  params.set('metadata[kind]', 'premium_purchase');
  params.set('metadata[amount_cents]', String(price));
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': `qqurz-premium-${identity.id}-${idempotency}`.slice(0, 255),
    },
    body: params.toString(),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !payload.url || !payload.id) return json({ error: payload.error?.message || 'Stripe could not create the premium checkout.' }, 502);
  return json({ provider: 'stripe', checkoutUrl: payload.url, sessionId: payload.id, amountCents: price, currency: 'USD' });
}

async function verifyStripeWebhook(request: Request, env: PaymentsEnv): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!secret) return json({ error: 'Stripe webhook verification is not configured.' }, 503);
  const signatureHeader = request.headers.get('stripe-signature') ?? '';
  const parts = Object.fromEntries(signatureHeader.split(',').map(part => part.trim().split('=', 2)));
  const timestamp = Number(parts.t);
  const signature = parts.v1 ?? '';
  const raw = await request.text();
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return json({ error: 'Stale Stripe webhook.' }, 400);
  const expected = await hmacHex(secret, `${timestamp}.${raw}`);
  if (!constantTimeHexEqual(expected, signature)) return json({ error: 'Invalid Stripe webhook signature.' }, 400);
  const event = JSON.parse(raw) as { id?: string; type?: string; data?: { object?: { id?: string; payment_status?: string; amount_total?: number; metadata?: Record<string, string> } } };
  if (event.type !== 'checkout.session.completed') return json({ received: true });
  const session = event.data?.object;
  const accountId = clean(session?.metadata?.account_id, 80);
  const amountCents = Math.floor(Number(session?.metadata?.amount_cents));
  if (!event.id || !session?.id || session.payment_status !== 'paid' || session?.metadata?.kind !== 'premium_purchase' || !accountId || !Number.isFinite(amountCents) || amountCents <= 0) {
    return json({ error: 'Stripe event does not match a QQURZ premium purchase.' }, 400);
  }
  const { response, data } = await ledgerJson<{ ok?: boolean }>(env, '/internal/provider-credit', {
    method: 'POST', headers: internalHeaders(env), body: JSON.stringify({
      accountId, amountCents, purpose: 'premium_purchase', provider: 'stripe', providerReference: session.id,
      idempotencyKey: `stripe-event:${event.id}`, reference: 'premium3d', metadata: { stripeEventId: event.id },
    }),
  });
  return response.ok ? json({ received: true, ledger: data }) : json({ error: data.error || 'Ledger rejected Stripe event.' }, response.status);
}

async function verifyNuveiWebhook(request: Request, env: PaymentsEnv): Promise<Response> {
  if (!env.NUVEI_SECRET_KEY) return json({ error: 'Nuvei webhook verification is not configured.' }, 503);
  const raw = await request.text();
  const form = new URLSearchParams(raw);
  const totalAmount = form.get('totalAmount') ?? '';
  const currency = form.get('currency') ?? '';
  const responseTimeStamp = form.get('responseTimeStamp') ?? '';
  const transactionId = form.get('ppp_TransactionID') ?? '';
  const status = form.get('Status') ?? '';
  const productId = form.get('productId') ?? form.get('item_number_1') ?? '';
  const supplied = (form.get('advanceResponseChecksum') ?? '').toLowerCase();
  const expected = (await sha256(`${env.NUVEI_SECRET_KEY}${totalAmount}${currency}${responseTimeStamp}${transactionId}${status}${productId}`)).toLowerCase();
  if (!supplied || !constantTimeHexEqual(expected, supplied)) return json({ error: 'Invalid Nuvei DMN checksum.' }, 400);
  if (!transactionId) return json({ error: 'Nuvei transaction id is missing.' }, 400);
  if (!['APPROVED', 'SUCCESS'].includes(status.toUpperCase())) return new Response('OK', { status: 200 });
  if (currency.toUpperCase() !== 'USD') return json({ error: 'Unexpected deposit currency.' }, 400);
  const intent = await verifyDepositIntent(env, productId);
  const amountCents = Math.round(Number(totalAmount) * 100);
  if (!intent || !Number.isFinite(amountCents) || amountCents !== intent.amountCents) return json({ error: 'Deposit intent does not match the approved transaction.' }, 400);
  const { response, data } = await ledgerJson<{ ok?: boolean }>(env, '/internal/provider-credit', {
    method: 'POST', headers: internalHeaders(env), body: JSON.stringify({
      accountId: intent.accountId, amountCents, purpose: 'wallet_deposit', provider: 'nuvei', providerReference: transactionId,
      idempotencyKey: `nuvei-payment:${transactionId}`, reference: productId, metadata: { responseTimeStamp, status },
    }),
  });
  return response.ok ? new Response('OK', { status: 200 }) : json({ error: data.error || 'Ledger rejected Nuvei deposit.' }, response.status);
}

async function requestWithdrawal(request: Request, env: PaymentsEnv, identity: AccountPaymentIdentity): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { amountCents?: unknown; idempotencyKey?: unknown };
  const amountCents = parseCents(body.amountCents, 500, 1_000_000);
  const idempotencyKey = clean(body.idempotencyKey, 160) || clean(request.headers.get('idempotency-key'), 160);
  if (!amountCents || !idempotencyKey) return json({ error: 'Withdrawal amount and idempotency key are required.' }, 400);
  if (!nuveiConfigured(env)) return json({ error: 'The approved withdrawal provider is not configured yet.' }, 503);
  const { response, data } = await ledgerJson<{ transaction?: unknown; wallet?: WalletSnapshot }>(env, '/internal/request-withdrawal', {
    method: 'POST', headers: internalHeaders(env), body: JSON.stringify({ accountId: identity.id, amountCents, idempotencyKey, reference: `withdrawal:${identity.id}` }),
  });
  if (!response.ok) return json({ error: data.error || 'Withdrawal could not be reserved.' }, response.status);
  return json({ status: 'reserved', provider: 'nuvei', amountCents, wallet: data.wallet, message: 'Funds are reserved. Provider payout execution requires the account payment token configured during KYC/funding.' }, 202);
}

export async function handlePaymentRequest(request: Request, env: PaymentsEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/payments/')) return null;

  if (url.pathname === '/payments/status' && request.method === 'GET') {
    return json({
      ledger: true,
      competitionProvider: env.REAL_MONEY_PROVIDER ?? 'disabled',
      competitionProviderConfigured: nuveiConfigured(env),
      premiumProvider: stripeConfigured(env) ? 'stripe' : 'disabled',
      realMoneyEnabled: env.REAL_MONEY_ENABLED === 'enabled',
      jurisdictionPolicyConfigured: Boolean(env.REAL_MONEY_JURISDICTIONS_JSON),
      browserAuthoritativeBalance: false,
    });
  }
  if (url.pathname === '/payments/webhooks/stripe' && request.method === 'POST') return verifyStripeWebhook(request, env);
  if (url.pathname === '/payments/webhooks/nuvei' && request.method === 'POST') return verifyNuveiWebhook(request, env);

  const identity = await authenticatedIdentity(request, env);
  if (!identity) return json({ error: 'Sign in required.' }, 401);

  if (url.pathname === '/payments/wallet' && request.method === 'GET') return json(await walletFor(env, identity.id));
  if (url.pathname === '/payments/transactions' && request.method === 'GET') {
    const { response, data } = await ledgerJson<{ transactions?: unknown[] }>(env, `/transactions/${encodeURIComponent(identity.id)}`);
    return json(data, response.status);
  }
  if (url.pathname === '/payments/deposit' && request.method === 'POST') return createNuveiDeposit(request, env, identity);
  if (url.pathname === '/payments/withdrawal' && request.method === 'POST') return requestWithdrawal(request, env, identity);
  if (url.pathname === '/payments/premium/checkout' && request.method === 'POST') return createPremiumCheckout(request, env, identity);
  return json({ error: 'Payment route not found.' }, 404);
}

export async function holdCompetitionFunds(env: PaymentsEnv, input: { accountId: string; amountCents: number; purpose: 'friend_match_entry' | 'tournament_entry' | 'color_bid' | 'position_bid'; reference: string; idempotencyKey: string }): Promise<{ ok: boolean; holdId?: string; error?: string }> {
  const { response, data } = await ledgerJson<{ hold?: { id?: string } }>(env, '/internal/hold', {
    method: 'POST', headers: internalHeaders(env), body: JSON.stringify(input),
  });
  return response.ok ? { ok: true, holdId: data.hold?.id } : { ok: false, error: data.error || 'Could not hold competition funds.' };
}

export async function releaseCompetitionHold(env: PaymentsEnv, input: { holdId: string; idempotencyKey: string }): Promise<void> {
  await ledgerJson(env, '/internal/release-hold', { method: 'POST', headers: internalHeaders(env), body: JSON.stringify(input) });
}

export async function settleCompetitionFunds(env: PaymentsEnv, input: { contestId: string; winnerAccountId: string; holdIds: string[]; platformFeeBps?: number; prizePurpose?: 'friend_match_prize' | 'tournament_prize' }): Promise<{ ok: boolean; error?: string; potCents?: number; feeCents?: number; prizeCents?: number }> {
  const { response, data } = await ledgerJson<{ potCents?: number; feeCents?: number; prizeCents?: number }>(env, '/internal/settle-contest', {
    method: 'POST', headers: internalHeaders(env), body: JSON.stringify(input),
  });
  return response.ok ? { ok: true, potCents: data.potCents, feeCents: data.feeCents, prizeCents: data.prizeCents } : { ok: false, error: data.error || 'Competition settlement failed.' };
}
