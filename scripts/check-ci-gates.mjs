import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) {
    console.error(`QQURZ CI gate check failed: ${message}`);
    process.exit(1);
  }
}

const quality = read('.github/workflows/quality-gates.yml');
const frontendDeploy = read('.github/workflows/deploy-pages.yml');
const apiDeploy = read('.github/workflows/deploy-realtime.yml');
const pkg = JSON.parse(read('package.json'));

for (const [script, fragment] of [
  ['typecheck', 'tsc -b'],
  ['lint', 'scripts/lint.mjs'],
  ['test:unit', 'tests/unit'],
  ['check:bundle', 'check:performance'],
  ['test:e2e', 'playwright test'],
]) {
  requireText(String(pkg.scripts?.[script] ?? ''), fragment, `package script ${script} is missing its required gate.`);
}

for (const [needle, message] of [
  ['push:', 'quality gates must run on push.'],
  ['Frontend TypeScript', 'frontend TypeScript must be an explicit CI step.'],
  ['Source lint', 'lint must be an explicit CI step.'],
  ['Unit tests', 'unit tests must be an explicit CI step.'],
  ['Integration tests', 'integration tests must be an explicit CI step.'],
  ['Build production artifact', 'production-like build must be an explicit CI step.'],
  ['Enforce bundle-size budgets', 'bundle-size budgets must be enforced after build.'],
  ['Run Playwright mobile and desktop flows', 'Playwright mobile/end-to-end tests must be part of CI.'],
  ['Release gate', 'CI must expose one final release gate.'],
]) requireText(quality, needle, message);

if (/push:\s*\n\s*branches:/.test(quality)) {
  console.error('QQURZ CI gate check failed: quality gates must run on every push, not only named branches.');
  process.exit(1);
}

for (const [workflow, label] of [[frontendDeploy, 'frontend'], [apiDeploy, 'API']]) {
  requireText(workflow, 'push:', `${label} deployment must run from a branch push.`);
  requireText(workflow, 'workflow_dispatch:', `${label} deployment must support an explicit manual release.`);
  requireText(workflow, 'npm run check:deploy', `${label} deployment must verify deployment architecture before publishing.`);
  requireText(workflow, 'npm run check:ci', `${label} deployment must run the CI architecture guard before publishing.`);
}

requireText(frontendDeploy, 'Atomically deploy immutable frontend artifact', 'frontend publish must remain an atomic immutable Pages deployment.');
requireText(apiDeploy, 'Atomically deploy isolated Worker version', 'API publish must deploy one atomic Worker version.');
requireText(apiDeploy, 'Roll back unhealthy Worker release', 'API deployment must attempt rollback when the post-deploy health check fails.');
requireText(apiDeploy, 'Fail deployment after smoke-test rollback', 'an unhealthy API release must leave the workflow failed.');

console.log('QQURZ CI gates OK: every push runs type/lint/test/build/bundle/E2E validation, and environment deploys wait for successful branch-triggered deployments with preflight architecture checks and atomic publication safeguards.');
