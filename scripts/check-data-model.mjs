import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('server/src/data/schema.ts') + read('server/src/data/migrations.ts');
const gateway = read('server/src/gateway.ts');
const wrangler = read('server/wrangler.jsonc');
const registry = read('server/src/data/registry.ts');
const outbox = read('server/src/data/outbox.ts');

const requiredTables = [
  'users','profiles','auth_identities','auth_tokens','sessions','ratings','games','game_moves','game_participants',
  'friendships','friend_invites','follows','tournaments','tournament_registrations','tournament_rounds','tournament_pairings','tournament_standings',
  'payment_customers','payment_intents','wallet_accounts','ledger_transactions','ledger_entries','wallet_balances','payouts','refunds',
  'subscriptions','premium_entitlements','compliance_attestations','moderation_reports','moderation_records','device_records','security_events','notifications','audit_logs','idempotency_keys',
  'provider_webhook_events',
];
const requiredProjectionFiles = [
  'server/src/data/accountProjection.ts','server/src/data/gameProjection.ts','server/src/data/tournamentProjection.ts','server/src/data/paymentProjection.ts','server/src/data/notificationProjection.ts','server/src/data/moderationProjection.ts',
];
const errors = [];
for (const table of requiredTables) if (!new RegExp(`\\b${table}\\b`).test(schema)) errors.push(`missing table: ${table}`);
for (const path of requiredProjectionFiles) {
  try { const text = read(path); if (!/queueCanonicalProjection/.test(text)) errors.push(`${path} is not outbox-backed`); }
  catch { errors.push(`missing projection: ${path}`); }
}
if (!/"name":\s*"DATA"/.test(wrangler) || !/"DataRegistry"/.test(wrangler)) errors.push('DATA Durable Object binding/export is missing');
if (!/export \{[^}]*DataRegistry/.test(gateway)) errors.push('gateway does not export DataRegistry');
if (!/ensureProductionDataSchema/.test(registry)) errors.push('registry is not migration-backed');
if (!/transactionSync/.test(registry)) errors.push('canonical command batches are not transactional');
if (!/canonical-outbox:v1:/.test(outbox)) errors.push('durable canonical projection outbox is missing');
for (const guard of ['ledger transactions are append-only','ledger entries are append-only','audit logs are append-only','security events are append-only']) {
  if (!schema.includes(guard)) errors.push(`missing immutable-data guard: ${guard}`);
}
if (!/Double-entry ledger transaction must balance to zero cents/.test(registry)) errors.push('double-entry balance validation is missing');
if (errors.length) {
  console.error('QQURZ production data model check failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`QQURZ production data model OK: ${requiredTables.length} canonical tables, versioned schema, outbox projections, balanced immutable ledger/audit guards.`);
