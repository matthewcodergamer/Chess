import { DurableObject } from 'cloudflare:workers';
import { TIME_CONTROL_PRESETS, tournamentTimeTemplateFor, type TournamentTimeTemplateId } from '../../shared/timeControl';

export type TournamentEnv = {
  TOURNAMENTS?: DurableObjectNamespace<TournamentRegistry>;
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
type TournamentStatus = 'open' | 'filling' | 'ready' | 'in_progress' | 'complete';
type PayoutGroup = {
  label: string;
  fromPlace: number;
  toPlace: number;
  recipients: number;
  poolBps: number;
  groupCents: number;
  eachCents: number;
  bonusRecipients: number;
};
type Tournament = {
  id: string;
  name: string;
  entryCents: number;
  prizeLabel: string;
  format: string;
  timeControl: string;
  baseMinutes: number;
  incrementSeconds: number;
  timeControlTemplateId: TournamentTimeTemplateId;
  allowedTimeControls: string[];
  seats: number;
  rounds: number;
  registeredSeats: number;
  status: TournamentStatus;
  fullRegistrationCents: number;
  grossCents: number;
  platformRakeBps: number;
  platformFeeCents: number;
  prizePoolCents: number;
  paidPlaces: number;
  payoutGroups: PayoutGroup[];
  annualOnly: boolean;
  registrationOpen: boolean;
  guaranteedPrizeCents?: number;
  guaranteeFundingGapCents?: number;
  currentGrossCents: number;
  currentPlatformFeeCents: number;
  currentPrizePoolCents: number;
  testOnly: boolean;
};
type Registration = { registrationId: string; sessionId: string; playerName: string; createdAt: number };
type RegistryState = Record<string, Registration[]>;
type RegistrySnapshot = Record<string, {
  registeredSeats: number;
  status: TournamentStatus;
  currentGrossCents: number;
  currentPlatformFeeCents: number;
  currentPrizePoolCents: number;
}>;

type StripeSession = {
  payment_status?: string;
  payment_intent?: string;
  metadata?: { item_id?: string; kind?: string; room_code?: string; bid_cents?: string; desired_color?: string };
  error?: { message?: string };
};

const PLATFORM_RAKE_BPS = 2_000;
const REGULAR_SEEDS = [16, 32, 64, 128, 256, 512, 1024, 2048] as const;
const ANNUAL_SEATS = 4096;
const ANNUAL_ENTRY_CENTS = 50_000;
const ANNUAL_GUARANTEE_CENTS = 200_000_000;
const SEEDS = [...REGULAR_SEEDS, ANNUAL_SEATS] as const;
const ENTRY_CENTS = [1_000, 2_000, 5_000, 10_000, 50_000] as const;
const POSITION_BIDS: Record<string, number> = { 'position-bid-200': 200, 'position-bid-500': 500 };
const COLOR_BIDS: Record<string, number> = { 'color-bid-200': 200, 'color-bid-500': 500 };

function isAnnual(seats: number, entryCents: number): boolean {
  return seats === ANNUAL_SEATS && entryCents === ANNUAL_ENTRY_CENTS;
}
function combinationAvailable(seats: number, entryCents: number): boolean {
  if (seats === ANNUAL_SEATS) return entryCents === ANNUAL_ENTRY_CENTS;
  return REGULAR_SEEDS.includes(seats as (typeof REGULAR_SEEDS)[number])
    && ENTRY_CENTS.includes(entryCents as (typeof ENTRY_CENTS)[number]);
}
function tournamentId(seats: number, entryCents: number): string { return `knockout-${seats}-${entryCents}`; }
function tournamentName(seats: number, entryCents: number): string {
  if (isAnnual(seats, entryCents)) return 'QQURZ Chess Cup';
  return `QQURZ ${seats}-Seed ${entryCents >= 50_000 ? 'Championship' : entryCents >= 10_000 ? 'Major' : entryCents >= 5_000 ? 'Open' : 'Knockout'}`;
}
function roundsFor(seats: number): number { return Math.max(1, Math.round(Math.log2(Math.max(2, seats)))); }
function statusFor(registered: number, seats: number): TournamentStatus {
  if (registered >= seats) return 'ready';
  if (registered > 0) return 'filling';
  return 'open';
}
function platformFeeCents(grossCents: number): number {
  return Math.floor((grossCents * PLATFORM_RAKE_BPS) / 10_000);
}
function prizePoolCents(grossCents: number): number {
  return grossCents - platformFeeCents(grossCents);
}
function paidPlacesFor(seats: number): number {
  if (seats <= 32) return 4;
  if (seats === 64) return 8;
  return Math.max(16, Math.floor(seats / 8));
}
type PayoutSpec = { label: string; fromPlace: number; toPlace: number; poolBps: number };
function payoutSpecs(seats: number): PayoutSpec[] {
  const paidPlaces = paidPlacesFor(seats);
  if (paidPlaces <= 4) {
    return [
      { label: '1st', fromPlace: 1, toPlace: 1, poolBps: 5_000 },
      { label: '2nd', fromPlace: 2, toPlace: 2, poolBps: 2_500 },
      { label: '3rd', fromPlace: 3, toPlace: 3, poolBps: 1_500 },
      { label: '4th', fromPlace: 4, toPlace: 4, poolBps: 1_000 },
    ];
  }
  if (paidPlaces <= 8) {
    return [
      { label: '1st', fromPlace: 1, toPlace: 1, poolBps: 4_000 },
      { label: '2nd', fromPlace: 2, toPlace: 2, poolBps: 2_000 },
      { label: '3rd', fromPlace: 3, toPlace: 3, poolBps: 1_200 },
      { label: '4th', fromPlace: 4, toPlace: 4, poolBps: 800 },
      { label: '5th–8th', fromPlace: 5, toPlace: 8, poolBps: 2_000 },
    ];
  }
  return [
    { label: '1st', fromPlace: 1, toPlace: 1, poolBps: 3_500 },
    { label: '2nd', fromPlace: 2, toPlace: 2, poolBps: 1_800 },
    { label: '3rd', fromPlace: 3, toPlace: 3, poolBps: 1_000 },
    { label: '4th', fromPlace: 4, toPlace: 4, poolBps: 700 },
    { label: '5th–8th', fromPlace: 5, toPlace: 8, poolBps: 1_600 },
    { label: `9th–${paidPlaces}th`, fromPlace: 9, toPlace: paidPlaces, poolBps: 1_400 },
  ];
}
function buildPayoutGroups(seats: number, poolCents: number): PayoutGroup[] {
  const specs = payoutSpecs(seats);
  let allocated = 0;
  return specs.map((spec, index) => {
    const recipients = spec.toPlace - spec.fromPlace + 1;
    const groupCents = index === specs.length - 1
      ? Math.max(0, poolCents - allocated)
      : Math.floor((poolCents * spec.poolBps) / 10_000);
    allocated += groupCents;
    return {
      ...spec,
      recipients,
      groupCents,
      eachCents: Math.floor(groupCents / recipients),
      bonusRecipients: groupCents % recipients,
    };
  });
}
function catalogTournament(seats: number, entryCents: number): Tournament {
  const grossCents = seats * entryCents;
  const feeCents = platformFeeCents(grossCents);
  const poolCents = prizePoolCents(grossCents);
  const annualOnly = isAnnual(seats, entryCents);
  const timeTemplate = tournamentTimeTemplateFor(seats, entryCents);
  const defaultControl = TIME_CONTROL_PRESETS[timeTemplate.defaultControl];
  return {
    id: tournamentId(seats, entryCents),
    name: tournamentName(seats, entryCents),
    entryCents,
    prizeLabel: annualOnly ? '$2,000,000 guarantee requires operator or sponsor funding' : '80% of collected entries allocated to the player prize pool',
    format: 'Single elimination',
    timeControl: defaultControl.label,
    baseMinutes: defaultControl.baseMs / 60_000,
    incrementSeconds: defaultControl.incrementMs / 1_000,
    timeControlTemplateId: timeTemplate.id,
    allowedTimeControls: [...timeTemplate.allowedControls],
    seats,
    rounds: roundsFor(seats),
    registeredSeats: 0,
    status: 'open',
    fullRegistrationCents: grossCents,
    grossCents,
    platformRakeBps: PLATFORM_RAKE_BPS,
    platformFeeCents: feeCents,
    prizePoolCents: poolCents,
    paidPlaces: paidPlacesFor(seats),
    payoutGroups: buildPayoutGroups(seats, poolCents),
    annualOnly,
    registrationOpen: !annualOnly,
    guaranteedPrizeCents: annualOnly ? ANNUAL_GUARANTEE_CENTS : undefined,
    guaranteeFundingGapCents: annualOnly ? Math.max(0, ANNUAL_GUARANTEE_CENTS - poolCents) : undefined,
    currentGrossCents: 0,
    currentPlatformFeeCents: 0,
    currentPrizePoolCents: 0,
    testOnly: true,
  };
}
const TOURNAMENT_CATALOG: Tournament[] = ENTRY_CENTS.flatMap(entry =>
  SEEDS.filter(seats => combinationAvailable(seats, entry)).map(seats => catalogTournament(seats, entry)),
);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function normalizePlayerName(value: unknown): string {
  const cleaned = String(value ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 28);
  return cleaned || 'Guest';
}
function premium3dPrice(env: TournamentEnv): number {
  const n = Number(env.PREMIUM_3D_PRICE_CENTS ?? '499');
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : 499;
}
function paymentMode(env: TournamentEnv): PaymentMode {
  const key = env.STRIPE_SECRET_KEY ?? '';
  if (env.PAYMENTS_MODE === 'test' && key.startsWith('sk_test_')) return 'test';
  if (env.PAYMENTS_MODE === 'live' && key.startsWith('sk_live_')) return 'live';
  return 'off';
}
function checkoutPattern(mode: PaymentMode): RegExp {
  return mode === 'live' ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
}
function itemFor(kind: CheckoutKind, itemId: string, env: TournamentEnv, desiredColor?: DesiredColor) {
  if (kind === 'premium3d' && itemId === '3d-pass') return { id: itemId, name: 'QQURZ Premium 3D Board Pass', cents: premium3dPrice(env) };
  if (kind === 'position_bid') { const cents = POSITION_BIDS[itemId]; if (cents) return { id: itemId, name: `QQURZ Chess960 position bid — $${cents / 100}`, cents }; }
  if (kind === 'color_bid') { const cents = COLOR_BIDS[itemId]; if (cents && desiredColor) return { id: itemId, name: `QQURZ ${desiredColor === 'white' ? 'White' : 'Black'} side bid — $${cents / 100}`, cents }; }
  if (kind === 'tournament') {
    const event = TOURNAMENT_CATALOG.find(value => value.id === itemId && value.registrationOpen);
    if (event) return { id: event.id, name: `${event.name} test entry`, cents: event.entryCents };
  }
  return null;
}

async function fetchStripeSession(sessionId: string, env: TournamentEnv): Promise<StripeSession> {
  const mode = paymentMode(env);
  if (mode === 'off') throw new Error('Stripe payment verification is not configured.');
  if (!checkoutPattern(mode).test(sessionId)) throw new Error(`Invalid ${mode} Checkout Session.`);
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const payload = await response.json().catch(() => ({})) as StripeSession;
  if (!response.ok) throw new Error(payload.error?.message || 'Could not verify the Checkout Session.');
  return payload;
}

async function createStripeCheckout(request: Request, env: TournamentEnv): Promise<Response> {
  const mode = paymentMode(env);
  if (mode === 'off') return json({ error: 'Stripe checkout is not configured for the selected payment mode.' }, 503);
  const body = await request.json().catch(() => ({})) as { itemId?: string; kind?: CheckoutKind; roomCode?: string; desiredColor?: DesiredColor };
  const kind: CheckoutKind = body.kind === 'premium3d' ? 'premium3d' : body.kind === 'position_bid' ? 'position_bid' : body.kind === 'color_bid' ? 'color_bid' : 'tournament';
  const desiredColor: DesiredColor | undefined = body.desiredColor === 'white' || body.desiredColor === 'black' ? body.desiredColor : undefined;

  if (mode === 'live' && kind === 'tournament') {
    return json({ error: 'Live cash-prize tournament entry cannot use Stripe. Keep tournament checkout in test mode until QQURZ integrates an approved provider and jurisdiction controls.' }, 403);
  }
  if (mode === 'live' && kind === 'position_bid' && env.LIVE_POSITION_BIDS !== 'enabled') return json({ error: 'Live paid position bidding is disabled. Use Stripe test mode until the competitive rules are approved.' }, 403);
  if (mode === 'live' && kind === 'color_bid' && env.LIVE_COLOR_BIDS !== 'enabled') return json({ error: 'Live paid color bidding is disabled. Use Stripe test mode until QQURZ enables automatic outbid refunds.' }, 403);
  if (kind === 'color_bid' && !desiredColor) return json({ error: 'Choose White or Black before opening a color bid checkout.' }, 400);
  const item = itemFor(kind, String(body.itemId ?? ''), env, desiredColor);
  if (!item) return json({ error: 'Unknown or unavailable QQURZ checkout item.' }, 400);
  const roomCode = String(body.roomCode ?? '').trim().toUpperCase();
  if ((kind === 'position_bid' || kind === 'color_bid') && !/^[A-Z0-9]{6}$/.test(roomCode)) return json({ error: 'A valid six-character room code is required for a room bid.' }, 400);

  const site = (env.PUBLIC_SITE_URL || 'https://qqurzchess.com').replace(/\/$/, '');
  const success = new URL(site + '/');
  success.searchParams.set('checkout', 'success');
  success.searchParams.set('kind', kind);
  success.searchParams.set('item', item.id);
  if (roomCode) success.searchParams.set('room', roomCode);
  if (desiredColor) success.searchParams.set('color', desiredColor);
  success.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  const cancel = new URL(site + '/');
  cancel.searchParams.set('checkout', 'cancel');
  cancel.searchParams.set('kind', kind);
  if (roomCode) cancel.searchParams.set('room', roomCode);
  if (desiredColor) cancel.searchParams.set('color', desiredColor);

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product_data][name]', item.name);
  params.set('line_items[0][price_data][unit_amount]', String(item.cents));
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', success.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'));
  params.set('cancel_url', cancel.toString());
  params.set('client_reference_id', `${kind}:${item.id}${roomCode ? `:${roomCode}` : ''}${desiredColor ? `:${desiredColor}` : ''}`);
  params.set('metadata[item_id]', item.id);
  params.set('metadata[kind]', kind);
  params.set('metadata[environment]', `qqurz-${mode}`);
  params.set('payment_intent_data[metadata][item_id]', item.id);
  params.set('payment_intent_data[metadata][kind]', kind);
  params.set('payment_intent_data[metadata][environment]', `qqurz-${mode}`);
  if (kind === 'position_bid' || kind === 'color_bid') {
    params.set('metadata[room_code]', roomCode);
    params.set('metadata[bid_cents]', String(item.cents));
    params.set('payment_intent_data[metadata][room_code]', roomCode);
    params.set('payment_intent_data[metadata][bid_cents]', String(item.cents));
  }
  if (kind === 'color_bid' && desiredColor) {
    params.set('metadata[desired_color]', desiredColor);
    params.set('payment_intent_data[metadata][desired_color]', desiredColor);
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !payload.url) return json({ error: payload.error?.message || 'Stripe could not create the Checkout Session.' }, 502);
  return json({ id: payload.id, url: payload.url, paymentMode: mode });
}

async function verifyStripeCheckout(url: URL, env: TournamentEnv): Promise<Response> {
  try {
    const sessionId = url.searchParams.get('session_id') ?? '';
    const payload = await fetchStripeSession(sessionId, env);
    const kind: CheckoutKind | '' = payload.metadata?.kind === 'premium3d' ? 'premium3d' : payload.metadata?.kind === 'position_bid' ? 'position_bid' : payload.metadata?.kind === 'color_bid' ? 'color_bid' : payload.metadata?.kind === 'tournament' ? 'tournament' : '';
    const desiredColor = payload.metadata?.desired_color === 'white' || payload.metadata?.desired_color === 'black' ? payload.metadata.desired_color : '';
    return json({
      paid: payload.payment_status === 'paid',
      itemId: payload.metadata?.item_id ?? '',
      kind,
      roomCode: payload.metadata?.room_code ?? '',
      bidCents: Number(payload.metadata?.bid_cents ?? '0') || 0,
      desiredColor,
      paymentMode: paymentMode(env),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not verify the Checkout Session.' }, 400);
  }
}

function registryStub(env: TournamentEnv): DurableObjectStub<TournamentRegistry> | null {
  if (!env.TOURNAMENTS) return null;
  return env.TOURNAMENTS.get(env.TOURNAMENTS.idFromName('qqurz-master-tournament-registry'));
}

async function registrySnapshot(env: TournamentEnv): Promise<RegistrySnapshot> {
  const stub = registryStub(env);
  if (!stub) return {};
  try {
    const response = await stub.fetch(new Request('https://tournament.internal/snapshot'));
    if (!response.ok) return {};
    return await response.json() as RegistrySnapshot;
  } catch { return {}; }
}

async function registerTournament(request: Request, env: TournamentEnv): Promise<Response> {
  const stub = registryStub(env);
  if (!stub) return json({ error: 'Tournament registration storage is not configured on the realtime server.' }, 503);
  const mode = paymentMode(env);
  if (mode === 'off') return json({ error: 'Tournament payment verification is not configured.' }, 503);
  if (mode === 'live') return json({ error: 'Live cash-prize tournament registration cannot use Stripe. Use test mode until an approved provider is integrated.' }, 403);
  const body = await request.json().catch(() => ({})) as { sessionId?: string; playerName?: string };
  const sessionId = String(body.sessionId ?? '').trim();
  try {
    const checkout = await fetchStripeSession(sessionId, env);
    const eventId = checkout.metadata?.item_id ?? '';
    const event = TOURNAMENT_CATALOG.find(value => value.id === eventId && value.registrationOpen);
    if (checkout.payment_status !== 'paid' || checkout.metadata?.kind !== 'tournament' || !event) {
      return json({ error: 'This payment does not match an open QQURZ tournament test entry.' }, 400);
    }
    const internal = await stub.fetch(new Request('https://tournament.internal/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId, sessionId, playerName: normalizePlayerName(body.playerName) }),
    }));
    return new Response(internal.body, { status: internal.status, headers: internal.headers });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not register tournament entry.' }, 400);
  }
}

export async function handleTournamentRequest(request: Request, env: TournamentEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/tournaments') {
    const mode = paymentMode(env);
    const live = await registrySnapshot(env);
    const tournaments = TOURNAMENT_CATALOG.map(event => {
      const state = live[event.id];
      return state ? { ...event, ...state } : event;
    });
    return json({
      tournaments,
      paymentMode: mode,
      paymentConfigured: mode !== 'off',
      liveTournamentPaymentsEnabled: false,
      cashTournamentCheckoutMode: 'test-only',
      complianceNotice: 'Cash-prize tournament checkout is test-only until QQURZ has an approved payment provider and jurisdiction review.',
      platformRakeBps: PLATFORM_RAKE_BPS,
      premium3dPriceCents: premium3dPrice(env),
      positionBidCents: [200, 500],
      livePositionBidsEnabled: mode === 'live' && env.LIVE_POSITION_BIDS === 'enabled',
      colorBidCents: [200, 500],
      liveColorBidsEnabled: mode === 'live' && env.LIVE_COLOR_BIDS === 'enabled',
    });
  }
  if (request.method === 'POST' && url.pathname === '/tournaments/register') return registerTournament(request, env);
  if (request.method === 'POST' && url.pathname === '/checkout') return createStripeCheckout(request, env);
  if (request.method === 'GET' && url.pathname === '/checkout/verify') return verifyStripeCheckout(url, env);
  return null;
}

export class TournamentRegistry extends DurableObject<TournamentEnv> {
  private registrations: RegistryState = {};

  constructor(ctx: DurableObjectState, env: TournamentEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.registrations = (await this.ctx.storage.get<RegistryState>('registrations')) ?? {};
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== 'tournament.internal') return json({ error: 'Not found.' }, 404);

    if (request.method === 'GET' && url.pathname === '/snapshot') {
      const snapshot: RegistrySnapshot = {};
      for (const event of TOURNAMENT_CATALOG) {
        const count = this.registrations[event.id]?.length ?? 0;
        if (!count) continue;
        const currentGrossCents = count * event.entryCents;
        snapshot[event.id] = {
          registeredSeats: count,
          status: statusFor(count, event.seats),
          currentGrossCents,
          currentPlatformFeeCents: platformFeeCents(currentGrossCents),
          currentPrizePoolCents: prizePoolCents(currentGrossCents),
        };
      }
      return json(snapshot);
    }

    if (request.method === 'POST' && url.pathname === '/claim') {
      const body = await request.json().catch(() => ({})) as { eventId?: string; sessionId?: string; playerName?: string };
      const event = TOURNAMENT_CATALOG.find(value => value.id === body.eventId && value.registrationOpen);
      const sessionId = String(body.sessionId ?? '').trim();
      if (!event || !sessionId) return json({ error: 'Invalid or closed tournament registration claim.' }, 400);
      const entries = this.registrations[event.id] ?? [];
      const existing = entries.find(entry => entry.sessionId === sessionId);
      const accounting = (count: number) => {
        const currentGrossCents = count * event.entryCents;
        return {
          currentGrossCents,
          currentPlatformFeeCents: platformFeeCents(currentGrossCents),
          currentPrizePoolCents: prizePoolCents(currentGrossCents),
        };
      };
      if (existing) {
        return json({
          eventId: event.id,
          registrationId: existing.registrationId,
          registeredSeats: entries.length,
          seats: event.seats,
          status: statusFor(entries.length, event.seats),
          alreadyRegistered: true,
          ...accounting(entries.length),
        });
      }
      if (entries.length >= event.seats) return json({ error: 'This tournament is already full.' }, 409);
      const registration: Registration = {
        registrationId: `reg_${crypto.randomUUID().replaceAll('-', '')}`,
        sessionId,
        playerName: normalizePlayerName(body.playerName),
        createdAt: Date.now(),
      };
      entries.push(registration);
      this.registrations[event.id] = entries;
      await this.ctx.storage.put('registrations', this.registrations);
      return json({
        eventId: event.id,
        registrationId: registration.registrationId,
        registeredSeats: entries.length,
        seats: event.seats,
        status: statusFor(entries.length, event.seats),
        alreadyRegistered: false,
        ...accounting(entries.length),
      });
    }

    return json({ error: 'Not found.' }, 404);
  }
}
