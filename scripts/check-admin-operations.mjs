import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd().endsWith(`${path.sep}server`) ? path.resolve(process.cwd(), '..') : process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const errors = [];

const admin = read('server/src/modules/admin/ops.ts');
const adminFacade = read('server/src/modules/admin/index.ts');
const operations = read('server/src/data/operations.ts');
const migrations = read('server/src/data/migrations.ts');
const matchmaking = read('server/src/modules/matchmaking/opsMatchmaker.ts');
const realtime = read('server/src/modules/realtime/index.ts');
const payments = read('server/src/modules/payments/index.ts');
const client = read('src/admin/client.ts');
const consoleUi = read('src/admin/AdminConsole.tsx');
const vite = read('vite.config.ts');
const adminHtml = read('admin.html');

for (const marker of [
  "url.pathname !== '/admin/ops'",
  "request.headers.get('x-integrity-admin')",
  'dataRegistryStub(env)',
  "idFromName('qqurz-global-lobby')",
]) if (!admin.includes(marker)) errors.push(`Admin operations API is missing ${marker}.`);

for (const marker of [
  'activeGames', 'stuckGames', 'tournaments', 'registration_total', 'refunds', 'transactionStates',
  'disputedResults', 'reports', 'bannedAccounts', 'payouts', 'failedWebhooks', 'audit', 'integrity_check',
]) if (!operations.includes(marker)) errors.push(`Canonical operations read model is missing ${marker}.`);

if (!matchmaking.includes('/internal/admin/presence') || !matchmaking.includes('INTEGRITY_ADMIN_SECRET')) {
  errors.push('Detailed online-player visibility must remain behind the admin capability.');
}
if (!migrations.includes('LATEST_DATA_SCHEMA_VERSION = 3') || !migrations.includes('provider_webhook_events')) {
  errors.push('Webhook outcome storage must be an ordered v3 schema migration.');
}
if (!payments.includes('recordProviderWebhook') || !payments.includes("provider: 'compliance'")) {
  errors.push('Provider webhook outcomes are not projected for operations visibility.');
}
if (!realtime.includes('OperationalDataRegistry as DataRegistry')) {
  errors.push('Realtime Worker must export the operations-aware DataRegistry under the stable DataRegistry class name.');
}
if (!adminFacade.includes('handleOperationsRequest')) errors.push('Admin module does not route the operations API.');

if (!client.includes('sessionStorage') || client.includes('localStorage')) {
  errors.push('Admin capability must use sessionStorage only and never localStorage.');
}
if (!client.includes("'x-integrity-admin': secret")) errors.push('Admin client is not sending the operator capability header.');
if (!consoleUi.includes('READ-ONLY') || !consoleUi.includes('No direct mutations')) {
  errors.push('Operations console must make its read-only boundary explicit.');
}
for (const forbidden of ['refundAccount(', 'banAccount(', 'updateLedger(', 'DELETE FROM', 'UPDATE wallet_balances']) {
  if (consoleUi.includes(forbidden) || client.includes(forbidden)) errors.push(`Browser operations code must not directly mutate protected state (${forbidden}).`);
}
if (!vite.includes("admin: 'admin.html'")) errors.push('Vite does not build the admin console as a separate entry.');
if (!adminHtml.includes('noindex,nofollow,noarchive') || !adminHtml.includes('/src/admin/main.tsx')) {
  errors.push('Admin HTML must be a dedicated noindex entry.');
}

if (errors.length) {
  console.error('\nQQURZ admin operations check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('');
  process.exit(1);
}

console.log('QQURZ admin operations OK: privileged read model, live presence, money/moderation/webhook health, audit visibility and separate session-only operator UI are wired.');
