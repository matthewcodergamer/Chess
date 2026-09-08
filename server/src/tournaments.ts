export type TournamentEnv = {
  STRIPE_SECRET_KEY?: string;
  PAYMENTS_MODE?: string;
  PUBLIC_SITE_URL?: string;
  PREMIUM_3D_PRICE_CENTS?: string;
  LIVE_TOURNAMENT_PAYMENTS?: string;
};

type PaymentMode = 'off' | 'test' | 'live';
type Tournament = {
  id: string;
  name: string;
  entryCents: number;
  prizeLabel: string;
  format: string;
  timeControl: string;
  seats: number;
  testOnly: boolean;
};

const TOURNAMENTS: Tournament[] = [
  { id: 'quick-10', name: 'QQURZ Quick 10', entryCents: 100, prizeLabel: 'Hosted event', format: 'Round robin', timeControl: '5+0', seats: 10, testOnly: true },
  { id: 'rapid-32', name: 'QQURZ Rapid Open', entryCents: 500, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 32, testOnly: true },
  { id: 'freestyle-100', name: 'Freestyle 960 100', entryCents: 1000, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 100, testOnly: true },
  { id: 'open-256', name: 'QQURZ Open 256', entryCents: 2000, prizeLabel: 'Prize schedule TBA', format: 'Swiss + knockout', timeControl: '10+0', seats: 256, testOnly: true },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function premium3dPrice(env: TournamentEnv): number {
  const configured = Number(env.PREMIUM_3D_PRICE_CENTS ?? '499');
  return Number.isFinite(configured) && configured >= 50 ? Math.floor(configured) : 499;
}

function paymentMode(env: TournamentEnv): PaymentMode {
  const key = env.STRIPE_SECRET_KEY ?? '';
  if (env.PAYMENTS_MODE === 'test' && key.startsWith('sk_test_')) return 'test';
  if (env.PAYMENTS_MODE === 'live' && key.startsWith('sk_live_')) return 'live';
  return 'off';
}

function itemFor(kind: 'tournament' | 'premium3d', itemId: string, env: TournamentEnv) {
  if (kind === 'premium3d' && itemId === '3d-pass') return { id: itemId, name: 'QQURZ Premium 3D Board Pass', cents: premium3dPrice(env) };
  if (kind === 'tournament') {
    const event = TOURNAMENTS.find(value => value.id === itemId);
    if (event) return { id: event.id, name: `${event.name} entry`, cents: event.entryCents };
  }
  return null;
}

async function createStripeCheckout(request: Request, env: TournamentEnv): Promise<Response> {
  const mode = paymentMode(env);
  if (mode === 'off') {
    return json({ error: 'Stripe checkout is not configured for the selected payment mode.' }, 503);
  }

  const body = await request.json().catch(() => ({})) as { itemId?: string; kind?: 'tournament' | 'premium3d' };
  const kind = body.kind === 'premium3d' ? 'premium3d' : 'tournament';
  if (mode === 'live' && kind === 'tournament' && env.LIVE_TOURNAMENT_PAYMENTS !== 'enabled') {
    return json({ error: 'Live tournament entry collection is intentionally disabled until QQURZ enables its tournament operations and compliance controls.' }, 403);
  }

  const item = itemFor(kind, String(body.itemId ?? ''), env);
  if (!item) return json({ error: 'Unknown tournament or premium item.' }, 400);

  const site = (env.PUBLIC_SITE_URL || 'https://qqurzchess.com').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product_data][name]', item.name);
  params.set('line_items[0][price_data][unit_amount]', String(item.cents));
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${site}/?checkout=success&kind=${kind}&item=${encodeURIComponent(item.id)}&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${site}/?checkout=cancel&kind=${kind}`);
  params.set('client_reference_id', `${kind}:${item.id}`);
  params.set('metadata[item_id]', item.id);
  params.set('metadata[kind]', kind);
  params.set('metadata[environment]', `qqurz-${mode}`);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !payload.url) return json({ error: payload.error?.message || 'Stripe could not create the Checkout Session.' }, 502);
  return json({ id: payload.id, url: payload.url, paymentMode: mode });
}

async function verifyStripeCheckout(url: URL, env: TournamentEnv): Promise<Response> {
  const mode = paymentMode(env);
  if (mode === 'off') return json({ error: 'Stripe payment verification is not configured.' }, 503);
  const sessionId = url.searchParams.get('session_id') ?? '';
  const pattern = mode === 'live' ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
  if (!pattern.test(sessionId)) return json({ error: `Invalid ${mode} Checkout Session.` }, 400);

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const payload = await response.json().catch(() => ({})) as {
    payment_status?: string;
    metadata?: { item_id?: string; kind?: string };
    error?: { message?: string };
  };
  if (!response.ok) return json({ error: payload.error?.message || 'Could not verify the Checkout Session.' }, 502);
  const kind = payload.metadata?.kind === 'premium3d' ? 'premium3d' : payload.metadata?.kind === 'tournament' ? 'tournament' : '';
  return json({
    paid: payload.payment_status === 'paid',
    itemId: payload.metadata?.item_id ?? '',
    kind,
    paymentMode: mode,
  });
}

export async function handleTournamentRequest(request: Request, env: TournamentEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/tournaments') {
    const mode = paymentMode(env);
    return json({
      tournaments: TOURNAMENTS,
      paymentMode: mode,
      paymentConfigured: mode !== 'off',
      premium3dPriceCents: premium3dPrice(env),
    });
  }
  if (request.method === 'POST' && url.pathname === '/checkout') return createStripeCheckout(request, env);
  if (request.method === 'GET' && url.pathname === '/checkout/verify') return verifyStripeCheckout(url, env);
  return null;
}
