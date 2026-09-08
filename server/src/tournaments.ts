export type TournamentEnv = {
  STRIPE_SECRET_KEY?: string;
  PAYMENTS_MODE?: string;
  PUBLIC_SITE_URL?: string;
  PREMIUM_3D_PRICE_CENTS?: string;
};

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
  { id: 'quick-1', name: 'QQURZ Quick Test', entryCents: 100, prizeLabel: 'Test event', format: 'Knockout', timeControl: '5+0', seats: 8, testOnly: true },
  { id: 'rapid-5', name: 'QQURZ Rapid Open', entryCents: 500, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 16, testOnly: true },
  { id: 'freestyle-10', name: 'Freestyle 960 Open', entryCents: 1000, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 32, testOnly: true },
  { id: 'founders-20', name: 'QQURZ Founders Prize Open', entryCents: 2000, prizeLabel: '$500 guaranteed prize fund', format: 'Knockout', timeControl: '10+0', seats: 32, testOnly: true },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function premium3dPrice(env: TournamentEnv): number {
  const configured = Number(env.PREMIUM_3D_PRICE_CENTS ?? '499');
  return Number.isFinite(configured) && configured >= 50 ? Math.floor(configured) : 499;
}

function paymentReady(env: TournamentEnv): boolean {
  return env.PAYMENTS_MODE === 'test' && Boolean(env.STRIPE_SECRET_KEY?.startsWith('sk_test_'));
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
  if (!paymentReady(env)) {
    return json({ error: 'Test checkout is not configured. Set PAYMENTS_MODE=test and add STRIPE_SECRET_KEY with a Stripe test key.' }, 503);
  }
  const body = await request.json().catch(() => ({})) as { itemId?: string; kind?: 'tournament' | 'premium3d' };
  const kind = body.kind === 'premium3d' ? 'premium3d' : 'tournament';
  const item = itemFor(kind, String(body.itemId ?? ''), env);
  if (!item) return json({ error: 'Unknown tournament or premium item.' }, 400);

  const site = (env.PUBLIC_SITE_URL || 'https://qqurzchess.com').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product_data][name]', item.name);
  params.set('line_items[0][price_data][unit_amount]', String(item.cents));
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${site}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${site}/?checkout=cancel`);
  params.set('client_reference_id', `${kind}:${item.id}`);
  params.set('metadata[item_id]', item.id);
  params.set('metadata[kind]', kind);
  params.set('metadata[environment]', 'qqurz-test');

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !payload.url) return json({ error: payload.error?.message || 'Stripe could not create the test Checkout Session.' }, 502);
  return json({ id: payload.id, url: payload.url });
}

async function verifyStripeCheckout(url: URL, env: TournamentEnv): Promise<Response> {
  if (!paymentReady(env)) return json({ error: 'Test payment verification is not configured.' }, 503);
  const sessionId = url.searchParams.get('session_id') ?? '';
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: 'Invalid test Checkout Session.' }, 400);

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const payload = await response.json().catch(() => ({})) as {
    payment_status?: string;
    metadata?: { item_id?: string; kind?: string };
    error?: { message?: string };
  };
  if (!response.ok) return json({ error: payload.error?.message || 'Could not verify the Checkout Session.' }, 502);
  return json({ paid: payload.payment_status === 'paid', itemId: payload.metadata?.item_id ?? '', kind: payload.metadata?.kind ?? '' });
}

export async function handleTournamentRequest(request: Request, env: TournamentEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/tournaments') {
    return json({
      tournaments: TOURNAMENTS,
      paymentMode: env.PAYMENTS_MODE === 'test' ? 'test' : 'off',
      paymentConfigured: paymentReady(env),
      premium3dPriceCents: premium3dPrice(env),
    });
  }
  if (request.method === 'POST' && url.pathname === '/checkout') return createStripeCheckout(request, env);
  if (request.method === 'GET' && url.pathname === '/checkout/verify') return verifyStripeCheckout(url, env);
  return null;
}
