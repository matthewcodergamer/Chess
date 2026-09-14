import { DATA_SCHEMA_SQL, DATA_SCHEMA_VERSION, REQUIRED_DATA_TABLES } from './schema';

export const LATEST_DATA_SCHEMA_VERSION = 3;

export const REQUIRED_PRODUCTION_DATA_TABLES = [
  ...REQUIRED_DATA_TABLES,
  'follows',
  'compliance_attestations',
  'provider_webhook_events',
] as const;

function currentVersion(storage: DurableObjectStorage): number {
  const row = storage.sql.exec(`SELECT value FROM schema_meta WHERE key='schema_version' LIMIT 1`).one() as { value?: string } | null;
  const version = Number(row?.value ?? DATA_SCHEMA_VERSION);
  return Number.isSafeInteger(version) && version >= 1 ? version : DATA_SCHEMA_VERSION;
}

function setVersion(storage: DurableObjectStorage, version: number): void {
  storage.sql.exec(
    `INSERT INTO schema_meta(key,value,updated_at) VALUES('schema_version',?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    String(version), Date.now(),
  );
}

function migrateV1ToV2(storage: DurableObjectStorage): void {
  const sql = storage.sql;
  const columns = sql.exec(`PRAGMA table_info(ledger_transactions)`).toArray() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'idempotency_scope')) {
    sql.exec(`ALTER TABLE ledger_transactions ADD COLUMN idempotency_scope TEXT NOT NULL DEFAULT 'legacy'`);
  }

  sql.exec(`
    CREATE INDEX IF NOT EXISTS ix_ledger_idempotency_scope
      ON ledger_transactions(idempotency_scope,idempotency_key);

    CREATE TABLE IF NOT EXISTS follows (
      follower_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      followed_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (follower_user_id <> followed_user_id),
      PRIMARY KEY(follower_user_id,followed_user_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS ix_follows_followed ON follows(followed_user_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS compliance_attestations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL,
      provider_reference TEXT,
      country_code TEXT NOT NULL DEFAULT '',
      region_code TEXT NOT NULL DEFAULT '',
      identity_verified INTEGER NOT NULL DEFAULT 0 CHECK (identity_verified IN (0,1)),
      age_verified INTEGER NOT NULL DEFAULT 0 CHECK (age_verified IN (0,1)),
      verified_age INTEGER CHECK (verified_age IS NULL OR verified_age BETWEEN 0 AND 130),
      tax_profile_verified INTEGER NOT NULL DEFAULT 0 CHECK (tax_profile_verified IN (0,1)),
      status TEXT NOT NULL CHECK (status IN ('pending','verified','failed','expired','revoked')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(provider,provider_reference)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS ix_compliance_user_status ON compliance_attestations(user_id,status,updated_at DESC);

    CREATE TRIGGER IF NOT EXISTS trg_ledger_transactions_no_update
      BEFORE UPDATE ON ledger_transactions BEGIN SELECT RAISE(ABORT,'ledger transactions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ledger_transactions_no_delete
      BEFORE DELETE ON ledger_transactions BEGIN SELECT RAISE(ABORT,'ledger transactions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
      BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'ledger entries are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
      BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'ledger entries are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
      BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'audit logs are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
      BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'audit logs are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_security_events_no_update
      BEFORE UPDATE ON security_events BEGIN SELECT RAISE(ABORT,'security events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_security_events_no_delete
      BEFORE DELETE ON security_events BEGIN SELECT RAISE(ABORT,'security events are append-only'); END;
  `);
}

function migrateV2ToV3(storage: DurableObjectStorage): void {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS provider_webhook_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      event_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('received','processed','rejected','failed')),
      http_status INTEGER NOT NULL DEFAULT 0 CHECK (http_status BETWEEN 0 AND 599),
      error TEXT,
      received_at INTEGER NOT NULL,
      processed_at INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS ix_provider_webhook_status
      ON provider_webhook_events(status,received_at DESC);
    CREATE INDEX IF NOT EXISTS ix_provider_webhook_event
      ON provider_webhook_events(provider,event_id);
  `);
}

export function ensureProductionDataSchema(storage: DurableObjectStorage): number {
  // The v1 schema is the bootstrap migration. Every later change must be an
  // ordered migration so deployed data is never rebuilt destructively.
  storage.sql.exec(DATA_SCHEMA_SQL);
  let version = currentVersion(storage);
  if (version > LATEST_DATA_SCHEMA_VERSION) {
    throw new Error(`Canonical data schema ${version} is newer than worker support ${LATEST_DATA_SCHEMA_VERSION}.`);
  }
  if (version < 2) {
    storage.transactionSync(() => migrateV1ToV2(storage));
    version = 2;
    setVersion(storage, version);
  } else {
    migrateV1ToV2(storage);
  }
  if (version < 3) {
    storage.transactionSync(() => migrateV2ToV3(storage));
    version = 3;
    setVersion(storage, version);
  } else {
    migrateV2ToV3(storage);
  }
  setVersion(storage, version);
  return version;
}
