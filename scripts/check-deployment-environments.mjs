import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`QQURZ deployment environment check failed: ${message}`);
  process.exit(1);
}

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const wrangler = JSON.parse(read('server/wrangler.jsonc'));
const envs = wrangler.env ?? {};
const required = ['development', 'staging', 'production'];
for (const name of required) {
  if (!envs[name]) fail(`missing Wrangler environment: ${name}`);
}

const names = new Set(required.map(name => envs[name].name));
if (names.size !== required.length) fail('development, staging, and production must use distinct Worker names.');

for (const name of required) {
  const cfg = envs[name];
  const vars = cfg.vars ?? {};
  if (vars.DEPLOYMENT_ENV !== name) fail(`${name} DEPLOYMENT_ENV must equal ${name}.`);
  if (!String(vars.PUBLIC_SITE_URL ?? '').startsWith('https://')) fail(`${name} PUBLIC_SITE_URL must use HTTPS.`);
  if (name !== 'development' && String(vars.ALLOWED_ORIGINS ?? '').includes('localhost')) fail(`${name} may not allow localhost origins.`);
  if (String(vars.REAL_MONEY_ENABLED ?? '') !== 'disabled') fail(`${name} must keep real-money competition disabled until a separate reviewed launch change.`);
}

for (const name of ['development', 'staging']) {
  const vars = envs[name].vars ?? {};
  if (vars.PAYMENTS_MODE !== 'test') fail(`${name} must use test payments.`);
  if (vars.NUVEI_ENV !== 'test') fail(`${name} must use Nuvei test mode.`);
}

const production = envs.production.vars ?? {};
if (production.PAYMENTS_MODE !== 'disabled') fail('production payments must remain disabled in this deployment baseline.');
if (production.NUVEI_ENV !== 'disabled') fail('production Nuvei must remain disabled in this deployment baseline.');
if (production.LIVE_TOURNAMENT_PAYMENTS !== 'disabled' || production.LIVE_POSITION_BIDS !== 'disabled' || production.LIVE_COLOR_BIDS !== 'disabled') {
  fail('production competitive payment features must remain disabled.');
}

const exportsConfig = wrangler.exports ?? {};
const exportEntries = Object.entries(exportsConfig);
if (!exportEntries.length) fail('Durable Object SQLite exports are required for production recovery.');
for (const [className, config] of exportEntries) {
  if (config?.type !== 'durable-object' || config?.storage !== 'sqlite') fail(`${className} must be a SQLite-backed Durable Object for PITR support.`);
}

const migrations = read('server/src/data/migrations.ts');
if (!/LATEST_DATA_SCHEMA_VERSION\s*=\s*\d+/.test(migrations)) fail('ordered data schema version is missing.');
if (!migrations.includes('ensureProductionDataSchema')) fail('production schema migration entry point is missing.');

const payments = read('server/src/modules/payments/index.ts');
for (const phrase of ['Test payment providers are forbidden in production.', 'Live money is forbidden outside production.']) {
  if (!payments.includes(phrase)) fail('payment environment isolation guard is missing.');
}

const frontendWorkflow = read('.github/workflows/deploy-pages.yml');
const apiWorkflow = read('.github/workflows/deploy-realtime.yml');
if (!frontendWorkflow.includes('wrangler pages deploy')) fail('frontend deployment must target Cloudflare Pages.');
if (!frontendWorkflow.includes('environment:')) fail('frontend deployment must use GitHub environments.');
if (!apiWorkflow.includes('wrangler deploy --env')) fail('API deployment must use Wrangler environments.');
if (!apiWorkflow.includes('environment:')) fail('API deployment must use GitHub environments.');

console.log('QQURZ deployment environments OK: Development → Staging → Production, HTTPS-only nonlocal origins, test-only nonproduction payments, production fail-closed payments, SQLite PITR readiness, ordered migrations, and environment-gated Cloudflare deployments.');
