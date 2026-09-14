const configuredBase = (import.meta.env.VITE_MULTIPLAYER_API as string | undefined)?.trim().replace(/\/$/, '');
export const ADMIN_API = configuredBase ?? '';
export const ADMIN_SECRET_KEY = 'qqurz:ops-capability';

export type OpsSummary = {
  onlinePlayers: number;
  queuedPlayers: number;
  activeGames: number;
  pausedGames: number;
  stuckGames: number;
  runningTournaments: number;
  registrations: number;
  openReports: number;
  pendingRefunds: number;
  pendingPayouts: number;
  failedWebhooks: number;
  disabledAccounts: number;
  [key: string]: number;
};

export type OnlinePlayer = {
  presenceId: string;
  name: string;
  accountId: string | null;
  state: 'online' | 'away' | 'game';
  roomCode: string | null;
  lastSeen: number;
  idleMs: number;
  region?: { colo?: string; country?: string; continent?: string };
};

export type OpsGame = {
  id: string;
  room_code: string | null;
  status: string;
  result_kind: string | null;
  result_text: string | null;
  base_ms: number;
  increment_ms: number;
  rated: number;
  rating_pool: string | null;
  tournament_id: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  last_activity_at: number;
  move_count: number;
  players: string | null;
  stale_ms: number;
  stuck: boolean;
};

export type OpsTournament = {
  id: string;
  slug: string | null;
  name: string;
  format: string;
  status: string;
  visibility: string;
  rated: number;
  capacity: number | null;
  entry_fee_cents: number;
  currency: string;
  starts_at: number | null;
  ends_at: number | null;
  current_round: number;
  updated_at: number;
  registration_total: number;
  checked_in_total: number;
  refunded_total: number;
};

export type OpsPaymentIntent = { id: string; user_id: string | null; provider: string; provider_intent_id: string | null; purpose: string; amount_cents: number; currency: string; status: string; game_id: string | null; tournament_id: string | null; created_at: number; updated_at: number; confirmed_at: number | null };
export type OpsTransaction = { id: string; transaction_type: string; purpose: string; reference: string; provider: string | null; provider_reference: string | null; status: string; sequence: number | null; created_at: number; reversed_by_transaction_id: string | null };
export type OpsRefund = { id: string; user_id: string | null; payment_intent_id: string | null; ledger_transaction_id: string | null; provider: string; provider_refund_id: string | null; amount_cents: number; currency: string; status: string; reason: string; created_at: number; processed_at: number | null };
export type OpsPayout = { id: string; user_id: string; username: string | null; display_name: string | null; provider: string; provider_payout_id: string | null; amount_cents: number; currency: string; status: string; requested_at: number; processed_at: number | null; failure_reason: string | null };
export type OpsReport = { id: string; reporter_user_id: string | null; target_user_id: string | null; game_id: string | null; tournament_id: string | null; category: string; narrative: string; status: string; priority: number; created_at: number; updated_at: number; reviewed_at: number | null; reporter_name?: string | null; target_name?: string | null };
export type OpsBannedAccount = { id: string; username: string | null; display_name: string | null; status: string; action: string | null; reason: string | null; starts_at: number | null; ends_at: number | null; action_created_at: number | null };
export type OpsWebhook = { id: string; provider: string; endpoint: string; event_id: string | null; status: string; http_status: number; error: string | null; received_at: number; processed_at: number | null };
export type OpsAudit = { event_id: string; actor_user_id: string | null; actor_type: string; action: string; entity_type: string; entity_id: string; request_id: string | null; ip_prefix: string; metadata_json: string; created_at: number };

export type OperationsSnapshot = {
  generatedAt: number;
  summary: OpsSummary;
  health: {
    overall: boolean;
    canonicalData: { reachable?: boolean; ok?: boolean; schemaVersion?: number | string; tables?: number; integrity?: string; missing?: string[] };
    matchmaking: { reachable?: boolean; onlinePlayers?: number; queueSize?: number; error?: string | null };
    services: { integrity: boolean; payments: boolean; notifications: boolean };
  };
  online: {
    onlinePlayers?: number;
    counts?: { online?: number; away?: number; game?: number };
    queueSize?: number;
    players?: OnlinePlayer[];
    waitingTickets?: Array<{ id: string; name: string; accountId: string | null; presenceId: string; createdAt: number; waitedMs: number }>;
  };
  games: OpsGame[];
  tournaments: OpsTournament[];
  payments: {
    intents: OpsPaymentIntent[];
    transactionStates: Array<{ status: string; count: number }>;
    transactions: OpsTransaction[];
    refunds: OpsRefund[];
    payouts: OpsPayout[];
  };
  moderation: { reports: OpsReport[]; disputedResults: OpsReport[]; bannedAccounts: OpsBannedAccount[] };
  webhooks: { recent: OpsWebhook[]; failed: OpsWebhook[] };
  audit: OpsAudit[];
  partial: boolean;
};

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function loadOperations(secret: string, signal?: AbortSignal): Promise<OperationsSnapshot> {
  if (!ADMIN_API) throw new AdminApiError('The operations API is not configured for this build.', 503);
  const response = await fetch(`${ADMIN_API}/admin/ops`, {
    method: 'GET',
    headers: { 'x-integrity-admin': secret },
    cache: 'no-store',
    signal,
  });
  const payload = await response.json().catch(() => ({})) as Partial<OperationsSnapshot> & { error?: string };
  if (!response.ok) throw new AdminApiError(payload.error || `Operations API returned ${response.status}.`, response.status);
  return payload as OperationsSnapshot;
}

export function storedAdminCapability(): string {
  try { return sessionStorage.getItem(ADMIN_SECRET_KEY)?.trim() ?? ''; }
  catch { return ''; }
}

export function storeAdminCapability(secret: string): void {
  try { sessionStorage.setItem(ADMIN_SECRET_KEY, secret); } catch { /* session-only convenience may be unavailable */ }
}

export function clearAdminCapability(): void {
  try { sessionStorage.removeItem(ADMIN_SECRET_KEY); } catch { /* ignore */ }
}
