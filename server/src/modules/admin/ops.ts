import { dataRegistryStub, type DataModelEnv } from '../../data/registry';
import type { MatchmakingModuleEnv } from '../matchmaking';

type OperationsEnv = DataModelEnv & MatchmakingModuleEnv & {
  INTEGRITY_ADMIN_SECRET?: string;
  INTEGRITY?: DurableObjectNamespace;
  PAYMENTS?: DurableObjectNamespace;
  NOTIFICATIONS?: DurableObjectNamespace;
};

type MatchmakerOps = {
  generatedAt?: number;
  onlinePlayers?: number;
  counts?: { online?: number; away?: number; game?: number };
  queueSize?: number;
  players?: unknown[];
  waitingTickets?: unknown[];
  error?: string;
};

type CanonicalOps = {
  generatedAt?: number;
  summary?: Record<string, number>;
  health?: Record<string, unknown>;
  games?: unknown[];
  tournaments?: unknown[];
  payments?: Record<string, unknown>;
  moderation?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
  audit?: unknown[];
  error?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function adminAuthorized(request: Request, secret: string | undefined): boolean {
  const expected = secret ?? '';
  const supplied = request.headers.get('x-integrity-admin') ?? '';
  if (expected.length < 24 || supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return mismatch === 0;
}

async function canonicalSnapshot(env: OperationsEnv): Promise<{ ok: boolean; status: number; payload: CanonicalOps }> {
  const response = await dataRegistryStub(env).fetch(new Request('https://data.internal/internal/admin/ops'));
  const payload = await response.json().catch(() => ({ error: 'Canonical operations data could not be decoded.' })) as CanonicalOps;
  return { ok: response.ok, status: response.status, payload };
}

async function presenceSnapshot(request: Request, env: OperationsEnv): Promise<{ ok: boolean; status: number; payload: MatchmakerOps }> {
  const id = env.MATCHMAKER.idFromName('qqurz-global-lobby');
  const stub = env.MATCHMAKER.get(id);
  const headers = new Headers();
  headers.set('x-integrity-admin', request.headers.get('x-integrity-admin') ?? '');
  const response = await stub.fetch(new Request('https://matchmaker.internal/internal/admin/presence', { headers }));
  const payload = await response.json().catch(() => ({ error: 'Presence operations data could not be decoded.' })) as MatchmakerOps;
  return { ok: response.ok, status: response.status, payload };
}

export async function handleOperationsRequest(request: Request, env: OperationsEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/admin/ops') return null;
  if (!adminAuthorized(request, env.INTEGRITY_ADMIN_SECRET)) return json({ error: 'Unauthorized operations access.' }, 401);
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  const [canonical, presence] = await Promise.all([
    canonicalSnapshot(env).catch(() => ({ ok: false, status: 503, payload: { error: 'Canonical data registry is unavailable.' } })),
    presenceSnapshot(request, env).catch(() => ({ ok: false, status: 503, payload: { error: 'Matchmaking presence is unavailable.' } })),
  ]);

  if (!canonical.ok && canonical.status === 401) return json({ error: 'Unauthorized operations access.' }, 401);
  const onlinePlayers = Number(presence.payload.onlinePlayers ?? 0);
  const queueSize = Number(presence.payload.queueSize ?? 0);
  const summary = {
    ...(canonical.payload.summary ?? {}),
    onlinePlayers,
    queuedPlayers: queueSize,
  };
  const canonicalHealth = canonical.payload.health ?? { ok: false };
  const canonicalHealthy = Boolean((canonicalHealth as { ok?: boolean }).ok);
  const overall = canonical.ok && presence.ok && canonicalHealthy;

  return json({
    generatedAt: Math.max(Number(canonical.payload.generatedAt ?? 0), Number(presence.payload.generatedAt ?? 0), Date.now()),
    summary,
    health: {
      overall,
      canonicalData: { reachable: canonical.ok, ...canonicalHealth },
      matchmaking: { reachable: presence.ok, onlinePlayers, queueSize, error: presence.ok ? null : presence.payload.error ?? 'Unavailable' },
      services: {
        integrity: Boolean(env.INTEGRITY),
        payments: Boolean(env.PAYMENTS),
        notifications: Boolean(env.NOTIFICATIONS),
      },
    },
    online: presence.payload,
    games: canonical.payload.games ?? [],
    tournaments: canonical.payload.tournaments ?? [],
    payments: canonical.payload.payments ?? { intents: [], transactionStates: [], transactions: [], refunds: [], payouts: [] },
    moderation: canonical.payload.moderation ?? { reports: [], disputedResults: [], bannedAccounts: [] },
    webhooks: canonical.payload.webhooks ?? { recent: [], failed: [] },
    audit: canonical.payload.audit ?? [],
    partial: !overall,
  });
}

export type OperationsModuleEnv = OperationsEnv;
