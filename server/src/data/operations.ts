import { DataRegistry as BaseDataRegistry, dataRegistryStub, type DataModelEnv } from './registry';

type SqlRow = Record<string, unknown>;
type ActiveGameRow = SqlRow & {
  id: string;
  room_code: string | null;
  status: string;
  created_at: number;
  started_at: number | null;
  base_ms: number;
  last_activity_at: number | null;
};

export type ProviderWebhookRecord = {
  id: string;
  provider: string;
  endpoint: string;
  eventId: string | null;
  status: 'received' | 'processed' | 'rejected' | 'failed';
  httpStatus: number;
  error: string | null;
  receivedAt: number;
  processedAt: number | null;
  metadata?: unknown;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function clean(value: unknown, max = 400): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function rows<T extends SqlRow = SqlRow>(storage: DurableObjectStorage, statement: string, ...bindings: unknown[]): T[] {
  return storage.sql.exec(statement, ...bindings).toArray() as T[];
}

function one<T extends SqlRow>(storage: DurableObjectStorage, statement: string, ...bindings: unknown[]): T | null {
  return storage.sql.exec(statement, ...bindings).one() as T | null;
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function recordProviderWebhook(env: DataModelEnv, record: ProviderWebhookRecord): Promise<void> {
  const response = await dataRegistryStub(env).fetch(new Request('https://data.internal/internal/admin/webhooks/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  }));
  if (!response.ok) throw new Error(`Could not record provider webhook (${response.status}).`);
}

export class OperationalDataRegistry extends BaseDataRegistry {
  private opsStorage(): DurableObjectStorage {
    return (this as unknown as { ctx: DurableObjectState }).ctx.storage;
  }

  private recordWebhook(record: ProviderWebhookRecord): Response {
    const storage = this.opsStorage();
    const status = ['received', 'processed', 'rejected', 'failed'].includes(record.status) ? record.status : 'failed';
    storage.sql.exec(
      `INSERT INTO provider_webhook_events(id,provider,endpoint,event_id,status,http_status,error,received_at,processed_at,metadata_json)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status,http_status=excluded.http_status,error=excluded.error,processed_at=excluded.processed_at,metadata_json=excluded.metadata_json`,
      clean(record.id, 180), clean(record.provider, 80), clean(record.endpoint, 180), clean(record.eventId, 180) || null,
      status, Math.max(0, Math.min(599, Math.floor(Number(record.httpStatus) || 0))), clean(record.error, 500) || null,
      Number(record.receivedAt) || Date.now(), record.processedAt ? Number(record.processedAt) : null,
      JSON.stringify(record.metadata ?? {}),
    );
    return json({ ok: true });
  }

  private operationsSnapshot(): Response {
    const storage = this.opsStorage();
    const now = Date.now();
    const activeGames = rows<ActiveGameRow>(storage, `
      SELECT g.id,g.room_code,g.status,g.result_kind,g.result_text,g.base_ms,g.increment_ms,g.rated,g.rating_pool,
             g.tournament_id,g.created_at,g.started_at,g.ended_at,
             COALESCE((SELECT MAX(COALESCE(m.committed_at,m.created_at)) FROM game_moves m WHERE m.game_id=g.id),g.started_at,g.created_at) AS last_activity_at,
             (SELECT COUNT(*) FROM game_moves m WHERE m.game_id=g.id) AS move_count,
             (SELECT GROUP_CONCAT(p.display_name_snapshot,' vs ') FROM game_participants p WHERE p.game_id=g.id) AS players
      FROM games g
      WHERE g.status IN ('created','active','paused')
      ORDER BY last_activity_at DESC LIMIT 100`);
    const games = activeGames.map(game => {
      const lastActivityAt = asNumber(game.last_activity_at) || asNumber(game.created_at);
      const baseMs = asNumber(game.base_ms);
      const staleThresholdMs = Math.max(5 * 60_000, baseMs * 2 + 60_000);
      return { ...game, last_activity_at: lastActivityAt, stale_ms: Math.max(0, now - lastActivityAt), stuck: now - lastActivityAt > staleThresholdMs };
    });

    const tournaments = rows(storage, `
      SELECT t.id,t.slug,t.name,t.format,t.status,t.visibility,t.rated,t.capacity,t.entry_fee_cents,t.currency,t.starts_at,t.ends_at,t.current_round,t.updated_at,
             COUNT(r.id) AS registration_total,
             SUM(CASE WHEN r.status IN ('checked_in','active','completed') THEN 1 ELSE 0 END) AS checked_in_total,
             SUM(CASE WHEN r.status='refunded' THEN 1 ELSE 0 END) AS refunded_total
      FROM tournaments t LEFT JOIN tournament_registrations r ON r.tournament_id=t.id
      GROUP BY t.id ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END,t.starts_at DESC LIMIT 100`);

    const intents = rows(storage, `SELECT id,user_id,provider,provider_intent_id,purpose,amount_cents,currency,status,game_id,tournament_id,created_at,updated_at,confirmed_at FROM payment_intents ORDER BY updated_at DESC LIMIT 120`);
    const transactionStates = rows(storage, `SELECT status,COUNT(*) AS count FROM ledger_transactions GROUP BY status ORDER BY status`);
    const transactions = rows(storage, `SELECT id,transaction_type,purpose,reference,provider,provider_reference,status,sequence,created_at,reversed_by_transaction_id FROM ledger_transactions ORDER BY created_at DESC LIMIT 120`);
    const refunds = rows(storage, `SELECT id,user_id,payment_intent_id,ledger_transaction_id,provider,provider_refund_id,amount_cents,currency,status,reason,created_at,processed_at FROM refunds ORDER BY created_at DESC LIMIT 100`);
    const payouts = rows(storage, `SELECT p.id,p.user_id,pr.username,pr.display_name,p.provider,p.provider_payout_id,p.amount_cents,p.currency,p.status,p.requested_at,p.processed_at,p.failure_reason FROM payouts p LEFT JOIN profiles pr ON pr.user_id=p.user_id ORDER BY p.requested_at DESC LIMIT 100`);

    const reports = rows(storage, `
      SELECT r.id,r.reporter_user_id,r.target_user_id,r.game_id,r.tournament_id,r.category,r.narrative,r.status,r.priority,r.created_at,r.updated_at,r.reviewed_at,
             reporter.display_name AS reporter_name,target.display_name AS target_name
      FROM moderation_reports r
      LEFT JOIN profiles reporter ON reporter.user_id=r.reporter_user_id
      LEFT JOIN profiles target ON target.user_id=r.target_user_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'triaged' THEN 1 WHEN 'reviewing' THEN 2 ELSE 3 END,r.priority DESC,r.created_at DESC LIMIT 150`);
    const disputedResults = rows(storage, `
      SELECT r.id,r.reporter_user_id,r.target_user_id,r.game_id,r.tournament_id,r.category,r.narrative,r.status,r.priority,r.created_at,r.updated_at,r.reviewed_at,
             reporter.display_name AS reporter_name,target.display_name AS target_name
      FROM moderation_reports r
      LEFT JOIN profiles reporter ON reporter.user_id=r.reporter_user_id
      LEFT JOIN profiles target ON target.user_id=r.target_user_id
      WHERE r.game_id IS NOT NULL AND r.status IN ('open','triaged','reviewing')
      ORDER BY r.priority DESC,r.updated_at DESC LIMIT 100`);
    const bannedAccounts = rows(storage, `
      SELECT DISTINCT u.id,p.username,p.display_name,u.status,m.action,m.reason,m.starts_at,m.ends_at,m.created_at AS action_created_at
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      LEFT JOIN moderation_records m ON m.id=(
        SELECT m2.id FROM moderation_records m2 WHERE m2.user_id=u.id AND (LOWER(m2.action) LIKE '%ban%' OR LOWER(m2.action) LIKE '%suspend%')
        ORDER BY m2.created_at DESC LIMIT 1
      )
      WHERE u.status='disabled' OR (m.id IS NOT NULL AND (m.ends_at IS NULL OR m.ends_at>?))
      ORDER BY COALESCE(m.created_at,u.updated_at) DESC LIMIT 100`, now);

    const webhooks = rows(storage, `SELECT id,provider,endpoint,event_id,status,http_status,error,received_at,processed_at FROM provider_webhook_events ORDER BY received_at DESC LIMIT 120`);
    const failedWebhooks = webhooks.filter(item => item.status === 'failed' || item.status === 'rejected' || asNumber(item.http_status) >= 400);
    const audit = rows(storage, `SELECT event_id,actor_user_id,actor_type,action,entity_type,entity_id,request_id,ip_prefix,metadata_json,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 160`);

    const tableRows = rows<{ name: string }>(storage, `SELECT name FROM sqlite_master WHERE type='table'`);
    const integrity = one<{ integrity_check?: string }>(storage, `PRAGMA integrity_check`);
    const schemaVersion = one<{ value?: string }>(storage, `SELECT value FROM schema_meta WHERE key='schema_version' LIMIT 1`)?.value ?? 'unknown';

    const summary = {
      activeGames: games.filter(game => game.status === 'active').length,
      pausedGames: games.filter(game => game.status === 'paused').length,
      stuckGames: games.filter(game => game.stuck).length,
      runningTournaments: tournaments.filter(item => item.status === 'running').length,
      registrations: tournaments.reduce((sum, item) => sum + asNumber(item.registration_total), 0),
      openReports: reports.filter(item => ['open', 'triaged', 'reviewing'].includes(String(item.status))).length,
      pendingRefunds: refunds.filter(item => ['pending', 'submitted'].includes(String(item.status))).length,
      pendingPayouts: payouts.filter(item => ['requested', 'review', 'submitted'].includes(String(item.status))).length,
      failedWebhooks: failedWebhooks.length,
      disabledAccounts: bannedAccounts.length,
    };

    return json({
      generatedAt: now,
      summary,
      health: { ok: integrity?.integrity_check === 'ok', schemaVersion, tables: tableRows.length, integrity: integrity?.integrity_check ?? 'unknown' },
      games,
      tournaments,
      payments: { intents, transactionStates, transactions, refunds, payouts },
      moderation: { reports, disputedResults, bannedAccounts },
      webhooks: { recent: webhooks, failed: failedWebhooks },
      audit,
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/admin/webhooks/record' && request.method === 'POST') {
      const record = await request.json().catch(() => null) as ProviderWebhookRecord | null;
      if (!record?.id || !record.provider || !record.endpoint) return json({ error: 'Invalid webhook record.' }, 400);
      return this.recordWebhook(record);
    }
    if (url.pathname === '/internal/admin/ops' && request.method === 'GET') return this.operationsSnapshot();
    return super.fetch(request);
  }
}
