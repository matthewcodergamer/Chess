import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePaymentEnvironment } from '../src/paymentEnvironment';

function config(overrides: Record<string, string | undefined> = {}) {
  return {
    deploymentEnv: 'staging',
    paymentsMode: 'test',
    nuveiEnv: 'test',
    realMoneyEnabled: 'disabled',
    ...overrides,
  };
}

test('production refuses test-mode payment routes', () => {
  const decision = decidePaymentEnvironment(config({ deploymentEnv: 'production', paymentsMode: 'test', nuveiEnv: 'test' }), '/payments/premium/checkout');
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.match(decision.message, /disabled|forbidden/i);
});

test('production baseline remains fail-closed while payments are disabled', () => {
  const decision = decidePaymentEnvironment(config({ deploymentEnv: 'production', paymentsMode: 'disabled', nuveiEnv: 'disabled' }), '/payments/deposit');
  assert.equal(decision.allowed, false);
});

test('staging refuses live payment mode', () => {
  const decision = decidePaymentEnvironment(config({ deploymentEnv: 'staging', paymentsMode: 'live' }), '/payments/premium/checkout');
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.match(decision.message, /forbidden/i);
});

test('development refuses real-money enablement', () => {
  const decision = decidePaymentEnvironment(config({ deploymentEnv: 'development', realMoneyEnabled: 'enabled' }), '/payments/deposit');
  assert.equal(decision.allowed, false);
});

test('staging allows only configured test-mode money routes', () => {
  const decision = decidePaymentEnvironment(config(), '/payments/premium/checkout');
  assert.deepEqual(decision, { allowed: true });
});

test('non-money payment reads are not blocked by environment policy', () => {
  const decision = decidePaymentEnvironment(config({ deploymentEnv: 'production', paymentsMode: 'disabled' }), '/payments/status');
  assert.deepEqual(decision, { allowed: true });
});
