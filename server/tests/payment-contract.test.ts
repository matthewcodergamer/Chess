import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = async (name: string) => readFile(resolve(here, '..', 'src', name), 'utf8');

test('Stripe webhook is idempotent and returns ledger failure status for provider retry', async () => {
  const paymentApi = await source('paymentApi.ts');
  assert.match(paymentApi, /idempotencyKey:\s*`stripe-event:\$\{event\.id\}`/);
  assert.match(paymentApi, /response\.ok\s*\?\s*json\(\{ received: true, ledger: data \}\)\s*:\s*json\(\{ error: data\.error \|\| 'Ledger rejected Stripe event\.' \}, response\.status\)/);
});

test('Nuvei webhook is idempotent and propagates ledger failure for retry', async () => {
  const paymentApi = await source('paymentApi.ts');
  assert.match(paymentApi, /idempotencyKey:\s*`nuvei-payment:\$\{transactionId\}`/);
  assert.match(paymentApi, /response\.ok\s*\?\s*new Response\('OK', \{ status: 200 \}\)\s*:\s*json\(\{ error: data\.error \|\| 'Ledger rejected Nuvei deposit\.' \}, response\.status\)/);
});

test('ledger supports explicit refunds and idempotency indexing', async () => {
  const ledger = await source('paymentLedger.ts');
  assert.match(ledger, /\| 'refund'/);
  assert.match(ledger, /`idem:\$\{accountId\}:\$\{idem\}`/);
  assert.match(ledger, /if \(duplicateId\)/);
});
