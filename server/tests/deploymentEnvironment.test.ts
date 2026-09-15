import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePaymentsRequest } from '../src/modules/payments/index';

function request(path: string): Request {
  return new Request(`https://qqurz.test${path}`, { method: 'POST' });
}

function env(overrides: Record<string, unknown> = {}): any {
  return {
    DEPLOYMENT_ENV: 'staging',
    PAYMENTS_MODE: 'test',
    NUVEI_ENV: 'test',
    REAL_MONEY_ENABLED: 'disabled',
    ...overrides,
  };
}

test('production refuses test-mode payment routes', async () => {
  const response = await handlePaymentsRequest(request('/payments/premium/checkout'), env({ DEPLOYMENT_ENV: 'production', PAYMENTS_MODE: 'test', NUVEI_ENV: 'test' }));
  assert.equal(response?.status, 503);
  const body = await response?.json() as { error?: string };
  assert.match(body.error ?? '', /disabled|forbidden/i);
});

test('staging refuses live payment mode', async () => {
  const response = await handlePaymentsRequest(request('/payments/premium/checkout'), env({ DEPLOYMENT_ENV: 'staging', PAYMENTS_MODE: 'live' }));
  assert.equal(response?.status, 503);
  const body = await response?.json() as { error?: string };
  assert.match(body.error ?? '', /forbidden/i);
});

test('development refuses real-money enablement', async () => {
  const response = await handlePaymentsRequest(request('/payments/deposit'), env({ DEPLOYMENT_ENV: 'development', REAL_MONEY_ENABLED: 'enabled' }));
  assert.equal(response?.status, 503);
});
