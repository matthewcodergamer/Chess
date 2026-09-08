export type TournamentEnv = {
  STRIPE_SECRET_KEY?: string;
  PAYMENTS_MODE?: string;
  PUBLIC_SITE_URL?: string;
  PREMIUM_3D_PRICE_CENTS?: string;
  LIVE_TOURNAMENT_PAYMENTS?: string;
  LIVE_POSITION_BIDS?: string;
  LIVE_COLOR_BIDS?: string;
};

type PaymentMode = 'off' | 'test' | 'live';
type CheckoutKind = 'tournament' | 'premium3d' | 'position_bid' | 'color_bid';
type DesiredColor = 'white' | 'black';
type Tournament = { id: string; name: string; entryCents: number; prizeLabel: string; format: string; timeControl: string; seats: number; testOnly: boolean };

const TOURNAMENTS: Tournament[] = [
  { id: 'quick-10', name: 'QQURZ Quick 10', entryCents: 100, prizeLabel: 'Hosted event', format: 'Round robin', timeControl: '5+0', seats: 10, testOnly: true },
  { id: 'rapid-32', name: 'QQURZ Rapid Open', entryCents: 500, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 32, testOnly: true },
  { id: 'freestyle-100', name: 'Freestyle 960 100', entryCents: 1000, prizeLabel: 'Prize schedule TBA', format: 'Swiss', timeControl: '10+0', seats: 100, testOnly: true },
  { id: 'open-256', name: 'QQURZ Open 256', entryCents: 2000, prizeLabel: 'Prize schedule TBA', format: 'Swiss + knockout', timeControl: '10+0', seats: 256, testOnly: true },
];
const POSITION_BIDS: Record<string, number> = { 'position-bid-200': 200, 'position-bid-500': 500 };
const COLOR_BIDS: Record<string, number> = { 'color-bid-200': 200, 'color-bid-500': 500 };

function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }); }
function premium3dPrice(env: TournamentEnv): number { const n = Number(env.PREMIUM_3D_PRICE_CENTS ?? '499'); return Number.isFinite(n) && n >= 50 ? Math.floor(n) : 499; }
function paymentMode(env: TournamentEnv): PaymentMode {
  const key = env.STRIPE_SECRET_KEY ?? '';
  if (env.PAYMENTS_MODE === 'test' && key.startsWith('sk_test_')) return 'test';
  if (env.PAYMENTS_MODE === 'live' && key.startsWith('sk_live_')) return 'live';
  return 'off';
}
function itemFor(kind: CheckoutKind, itemId: string, env: TournamentEnv, desiredColor?: DesiredColor) {
  if (kind === 'premium3d' && itemId === '3d-pass') return { id: itemId, name: 'QQURZ Premium 3D Board Pass', cents: premium3dPrice(env) };
  if (kind === 'position_bid') { const cents = POSITION_BIDS[itemId]; if (cents) return { id: itemId, name: `QQURZ Chess960 position bid — $${cents / 100}`, cents }; }
  if (kind === 'color_bid') { const cents = COLOR_BIDS[itemId]; if (cents && desiredColor) return { id: itemId, name: `QQURZ ${desiredColor === 'white' ? 'White' : 'Black'} side bid — $${cents / 100}`, cents }; }
  if (kind === 'tournament') { const event = TOURNAMENTS.find(v => v.id === itemId); if (event) return { id: event.id, name: `${event.name} entry`, cents: event.entryCents }; }
  return null;
}

async function createStripeCheckout(request: Request, env: TournamentEnv): Promise<Response> {
  const mode = paymentMode(env); if (mode === 'off') return json({ error: 'Stripe checkout is not configured for the selected payment mode.' }, 503);
  const body = await request.json().catch(() => ({})) as { itemId?: string; kind?: CheckoutKind; roomCode?: string; desiredColor?: DesiredColor };
  const kind: CheckoutKind = body.kind === 'premium3d' ? 'premium3d' : body.kind === 'position_bid' ? 'position_bid' : body.kind === 'color_bid' ? 'color_bid' : 'tournament';
  const desiredColor: DesiredColor | undefined = body.desiredColor === 'white' || body.desiredColor === 'black' ? body.desiredColor : undefined;
  if (mode === 'live' && kind === 'tournament' && env.LIVE_TOURNAMENT_PAYMENTS !== 'enabled') return json({ error: 'Live tournament entry collection is disabled until QQURZ enables its tournament operations controls.' }, 403);
  if (mode === 'live' && kind === 'position_bid' && env.LIVE_POSITION_BIDS !== 'enabled') return json({ error: 'Live paid position bidding is disabled. Use Stripe test mode until the competitive rules are approved.' }, 403);
  if (mode === 'live' && kind === 'color_bid' && env.LIVE_COLOR_BIDS !== 'enabled') return json({ error: 'Live paid color bidding is disabled. Use Stripe test mode until QQURZ enables automatic outbid refunds.' }, 403);
  if (kind === 'color_bid' && !desiredColor) return json({ error: 'Choose White or Black before opening a color bid checkout.' }, 400);
  const item = itemFor(kind, String(body.itemId ?? ''), env, desiredColor); if (!item) return json({ error: 'Unknown QQURZ checkout item.' }, 400);
  const roomCode = String(body.roomCode ?? '').trim().toUpperCase();
  if ((kind === 'position_bid' || kind === 'color_bid') && !/^[A-Z0-9]{6}$/.test(roomCode)) return json({ error: 'A valid six-character room code is required for a room bid.' }, 400);

  const site = (env.PUBLIC_SITE_URL || 'https://qqurzchess.com').replace(/\/$/, '');
  const success = new URL(site + '/'); success.searchParams.set('checkout', 'success'); success.searchParams.set('kind', kind); success.searchParams.set('item', item.id); if (roomCode) success.searchParams.set('room', roomCode); if (desiredColor) success.searchParams.set('color', desiredColor); success.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  const cancel = new URL(site + '/'); cancel.searchParams.set('checkout', 'cancel'); cancel.searchParams.set('kind', kind); if (roomCode) cancel.searchParams.set('room', roomCode); if (desiredColor) cancel.searchParams.set('color', desiredColor);
  const params = new URLSearchParams();
  params.set('mode', 'payment'); params.set('line_items[0][price_data][currency]', 'usd'); params.set('line_items[0][price_data][product_data][name]', item.name); params.set('line_items[0][price_data][unit_amount]', String(item.cents)); params.set('line_items[0][quantity]', '1');
  params.set('success_url', success.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}')); params.set('cancel_url', cancel.toString()); params.set('client_reference_id', `${kind}:${item.id}${roomCode ? `:${roomCode}` : ''}${desiredColor ? `:${desiredColor}` : ''}`);
  params.set('metadata[item_id]', item.id); params.set('metadata[kind]', kind); params.set('metadata[environment]', `qqurz-${mode}`);
  params.set('payment_intent_data[metadata][item_id]', item.id); params.set('payment_intent_data[metadata][kind]', kind); params.set('payment_intent_data[metadata][environment]', `qqurz-${mode}`);
  if (kind === 'position_bid' || kind === 'color_bid') {
    params.set('metadata[room_code]', roomCode); params.set('metadata[bid_cents]', String(item.cents));
    params.set('payment_intent_data[metadata][room_code]', roomCode); params.set('payment_intent_data[metadata][bid_cents]', String(item.cents));
  }
  if (kind === 'color_bid' && desiredColor) {
    params.set('metadata[desired_color]', desiredColor);
    params.set('payment_intent_data[metadata][desired_color]', desiredColor);
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  const payload = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !payload.url) return json({ error: payload.error?.message || 'Stripe could not create the Checkout Session.' }, 502);
  return json({ id: payload.id, url: payload.url, paymentMode: mode });
}

async function verifyStripeCheckout(url: URL, env: TournamentEnv): Promise<Response> {
  const mode = paymentMode(env); if (mode === 'off') return json({ error: 'Stripe payment verification is not configured.' }, 503);
  const sessionId = url.searchParams.get('session_id') ?? ''; const pattern = mode === 'live' ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
  if (!pattern.test(sessionId)) return json({ error: `Invalid ${mode} Checkout Session.` }, 400);
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const payload = await response.json().catch(() => ({})) as { payment_status?: string; metadata?: { item_id?: string; kind?: string; room_code?: string; bid_cents?: string; desired_color?: string }; error?: { message?: string } };
  if (!response.ok) return json({ error: payload.error?.message || 'Could not verify the Checkout Session.' }, 502);
  const kind: CheckoutKind | '' = payload.metadata?.kind === 'premium3d' ? 'premium3d' : payload.metadata?.kind === 'position_bid' ? 'position_bid' : payload.metadata?.kind === 'color_bid' ? 'color_bid' : payload.metadata?.kind === 'tournament' ? 'tournament' : '';
  const desiredColor = payload.metadata?.desired_color === 'white' || payload.metadata?.desired_color === 'black' ? payload.metadata.desired_color : '';
  return json({ paid: payload.payment_status === 'paid', itemId: payload.metadata?.item_id ?? '', kind, roomCode: payload.metadata?.room_code ?? '', bidCents: Number(payload.metadata?.bid_cents ?? '0') || 0, desiredColor, paymentMode: mode });
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
      positionBidCents: [200, 500],
      livePositionBidsEnabled: mode === 'live' && env.LIVE_POSITION_BIDS === 'enabled',
      colorBidCents: [200, 500],
      liveColorBidsEnabled: mode === 'live' && env.LIVE_COLOR_BIDS === 'enabled',
    });
  }
  if (request.method === 'POST' && url.pathname === '/checkout') return createStripeCheckout(request, env);
  if (request.method === 'GET' && url.pathname === '/checkout/verify') return verifyStripeCheckout(url, env);
  return null;
}
