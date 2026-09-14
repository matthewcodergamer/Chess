export const DATA_SCHEMA_VERSION = 1;

// Canonical relational model for durable product data. Live room state remains
// in the room Durable Object; completed/identity/financial/audit records land here.
export const DATA_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '♞',
  avatar_image TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'auto',
  privacy_json TEXT NOT NULL DEFAULT '{}',
  notification_settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('password','apple','google','passkey','other')),
  provider_subject TEXT NOT NULL,
  email_normalized TEXT,
  credential_hash TEXT,
  credential_salt TEXT,
  credential_iterations INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  disabled_at INTEGER,
  UNIQUE(provider, provider_subject)
) STRICT;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('verify_email','reset_password','magic_link','reauth')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS device_records (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  fingerprint_hash TEXT,
  device_name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  trusted_at INTEGER,
  revoked_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_device_user_fingerprint
  ON device_records(user_id, fingerprint_hash)
  WHERE user_id IS NOT NULL AND fingerprint_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  device_record_id TEXT REFERENCES device_records(id) ON DELETE SET NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  ip_prefix TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS ix_sessions_user_active ON sessions(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  device_record_id TEXT REFERENCES device_records(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0,1)),
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  ip_prefix TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_security_user_created ON security_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pool TEXT NOT NULL CHECK (pool IN ('chess960_rapid','chess960_blitz','chess960_bullet','chess960_correspondence')),
  rating REAL NOT NULL,
  deviation REAL NOT NULL,
  volatility REAL NOT NULL,
  rated_games INTEGER NOT NULL DEFAULT 0 CHECK (rated_games >= 0),
  last_rated_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, pool)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_ratings_pool_rating ON ratings(pool, rating DESC);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  slug TEXT COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','registration','running','paused','completed','cancelled')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
  rated INTEGER NOT NULL DEFAULT 1 CHECK (rated IN (0,1)),
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 1),
  entry_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (entry_fee_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  starts_at INTEGER,
  ends_at INTEGER,
  current_round INTEGER NOT NULL DEFAULT 0 CHECK (current_round >= 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  rules_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_tournaments_status_start ON tournaments(status, starts_at);

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('registered','checked_in','active','withdrawn','eliminated','completed','refunded')),
  seed INTEGER,
  registered_at INTEGER NOT NULL,
  checked_in_at INTEGER,
  withdrawn_at INTEGER,
  payment_intent_id TEXT,
  entry_ledger_transaction_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(tournament_id, user_id)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_tournament_reg_status ON tournament_registrations(tournament_id, status, seed);

CREATE TABLE IF NOT EXISTS tournament_rounds (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','pairing','active','complete','cancelled')),
  starts_at INTEGER,
  ends_at INTEGER,
  locked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(tournament_id, round_number)
) STRICT;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  room_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('created','active','paused','completed','aborted','void')),
  result_kind TEXT,
  result_text TEXT,
  winner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  position_id INTEGER,
  initial_fen TEXT,
  final_fen TEXT,
  base_ms INTEGER NOT NULL DEFAULT 0 CHECK (base_ms >= 0),
  increment_ms INTEGER NOT NULL DEFAULT 0 CHECK (increment_ms >= 0),
  rated INTEGER NOT NULL DEFAULT 0 CHECK (rated IN (0,1)),
  rating_pool TEXT,
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE SET NULL,
  tournament_round_id TEXT REFERENCES tournament_rounds(id) ON DELETE SET NULL,
  pairing_id TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX IF NOT EXISTS ix_games_ended ON games(ended_at DESC);
CREATE INDEX IF NOT EXISTS ix_games_tournament ON games(tournament_id, tournament_round_id);

CREATE TABLE IF NOT EXISTS game_participants (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  seat_no INTEGER NOT NULL CHECK (seat_no IN (1,2)),
  color TEXT NOT NULL CHECK (color IN ('white','black')),
  display_name_snapshot TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('win','loss','draw','void')),
  rating_pool TEXT,
  rating_before REAL,
  rating_after REAL,
  rating_deviation_before REAL,
  rating_deviation_after REAL,
  joined_at INTEGER,
  left_at INTEGER,
  UNIQUE(game_id, seat_no),
  UNIQUE(game_id, color)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_game_participant_user ON game_participants(user_id, game_id);

CREATE TABLE IF NOT EXISTS game_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  ply INTEGER NOT NULL CHECK (ply > 0),
  mover_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  mover_color TEXT NOT NULL CHECK (mover_color IN ('white','black')),
  uci TEXT,
  san TEXT NOT NULL,
  fen_after TEXT,
  client_sent_at INTEGER,
  server_received_at INTEGER,
  committed_at INTEGER,
  think_ms INTEGER CHECK (think_ms IS NULL OR think_ms >= 0),
  clock_after_ms INTEGER CHECK (clock_after_ms IS NULL OR clock_after_ms >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE(game_id, ply)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_game_moves_game_ply ON game_moves(game_id, ply);

CREATE TABLE IF NOT EXISTS tournament_pairings (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  round_id TEXT NOT NULL REFERENCES tournament_rounds(id) ON DELETE RESTRICT,
  board_number INTEGER NOT NULL CHECK (board_number > 0),
  white_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  black_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','active','complete','forfeit','bye','cancelled')),
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(round_id, board_number)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_pairings_user_white ON tournament_pairings(white_user_id, status);
CREATE INDEX IF NOT EXISTS ix_pairings_user_black ON tournament_pairings(black_user_id, status);

CREATE TABLE IF NOT EXISTS tournament_standings (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rank INTEGER NOT NULL CHECK (rank > 0),
  points_half INTEGER NOT NULL DEFAULT 0 CHECK (points_half >= 0),
  buchholz_half INTEGER NOT NULL DEFAULT 0,
  sonneborn_berger_half INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  byes INTEGER NOT NULL DEFAULT 0 CHECK (byes >= 0),
  games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(tournament_id, user_id)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_standings_rank ON tournament_standings(tournament_id, rank);

CREATE TABLE IF NOT EXISTS friendships (
  user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (user_a_id < user_b_id),
  PRIMARY KEY(user_a_id, user_b_id)
) STRICT;

CREATE TABLE IF NOT EXISTS friend_invites (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  expires_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK (from_user_id <> to_user_id)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_friend_invite
  ON friend_invites(from_user_id, to_user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS player_blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  CHECK (blocker_user_id <> blocked_user_id),
  PRIMARY KEY(blocker_user_id, blocked_user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS payment_customers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_customer_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_customer_id),
  UNIQUE(user_id, provider)
) STRICT;

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES payment_customers(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_intent_id TEXT,
  purpose TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('created','pending','requires_action','authorized','captured','failed','cancelled','refunded','partially_refunded')),
  idempotency_key TEXT NOT NULL UNIQUE,
  game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  UNIQUE(provider, provider_intent_id)
) STRICT;

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  account_type TEXT NOT NULL CHECK (account_type IN ('user','platform_revenue','escrow','external_clearing')),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','frozen','closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_wallet_currency
  ON wallet_accounts(user_id, currency)
  WHERE user_id IS NOT NULL AND account_type = 'user';

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  transaction_type TEXT NOT NULL,
  purpose TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','reversed','void')),
  sequence INTEGER,
  previous_hash TEXT,
  hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  reversed_by_transaction_id TEXT REFERENCES ledger_transactions(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_ledger_reference ON ledger_transactions(reference, created_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  wallet_account_id TEXT NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  bucket TEXT NOT NULL CHECK (bucket IN ('available','held','pending_withdrawal','debt','revenue','escrow','external')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_ledger_entries_wallet ON ledger_entries(wallet_account_id, id);
CREATE INDEX IF NOT EXISTS ix_ledger_entries_transaction ON ledger_entries(transaction_id);

CREATE TABLE IF NOT EXISTS wallet_balances (
  wallet_account_id TEXT NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  bucket TEXT NOT NULL CHECK (bucket IN ('available','held','pending_withdrawal','debt','revenue','escrow','external')),
  balance_cents INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  last_hash TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(wallet_account_id, bucket)
) STRICT;

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_account_id TEXT NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_payout_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('requested','review','submitted','paid','failed','cancelled','reversed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_at INTEGER NOT NULL,
  processed_at INTEGER,
  failure_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(provider, provider_payout_id)
) STRICT;

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payment_intent_id TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
  ledger_transaction_id TEXT REFERENCES ledger_transactions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_refund_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('pending','submitted','succeeded','failed','cancelled')),
  reason TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  UNIQUE(provider, provider_refund_id)
) STRICT;

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_subscription_id TEXT,
  plan_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','paused','cancelled','expired')),
  current_period_start INTEGER,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_subscription_id)
) STRICT;

CREATE TABLE IF NOT EXISTS premium_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entitlement_key TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase','subscription','grant','promotion')),
  source_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, entitlement_key, source_type, source_id)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_entitlement_active ON premium_entitlements(user_id, entitlement_key, status, ends_at);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  narrative TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open','triaged','reviewing','resolved','dismissed')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX IF NOT EXISTS ix_reports_queue ON moderation_reports(status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS moderation_records (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  report_id TEXT REFERENCES moderation_reports(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX IF NOT EXISTS ix_moderation_user ON moderation_records(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  delivered_at INTEGER,
  push_attempted_at INTEGER,
  expires_at INTEGER
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_dedupe
  ON notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_notifications_inbox ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system','moderator','provider','worker')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  request_id TEXT,
  ip_prefix TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_logs(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT,
  response_status INTEGER,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(scope, idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS ix_idempotency_expiry ON idempotency_keys(expires_at);
`;

export const REQUIRED_DATA_TABLES = [
  'users','profiles','auth_identities','auth_tokens','sessions','ratings','games','game_moves','game_participants',
  'friendships','friend_invites','player_blocks','tournaments','tournament_registrations','tournament_rounds','tournament_pairings',
  'tournament_standings','payment_customers','payment_intents','wallet_accounts','ledger_transactions','ledger_entries','wallet_balances',
  'payouts','refunds','subscriptions','premium_entitlements','moderation_reports','moderation_records','device_records','security_events',
  'notifications','audit_logs','idempotency_keys',
] as const;
