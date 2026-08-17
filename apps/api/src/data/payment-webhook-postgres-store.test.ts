import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PaymentWebhookPostgresStore } from './payment-webhook-postgres-store.js';
import { createPaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';

const evidence = createPaymentWebhookEvidence({
  provider: 'sandbox-gateway', providerEventReference: 'evt_001', providerPaymentReference: 'pay_001', eventType: 'payment_paid',
  commercialRecordReference: 'commercial:test:1', amountMinor: 125000, currency: 'ZAR', occurredAt: '2026-08-17T21:25:00.000Z', signatureVerified: true,
});

function mockPoolQuery(implementation: (sql: string, values?: readonly unknown[]) => { rowCount: number; rows: unknown[] }): Pick<Pool, 'query'> {
  return {
    query: (async (sql: string, values?: readonly unknown[]) => implementation(sql, values)) as Pool['query'],
  };
}

test('Postgres payment webhook store accepts a newly inserted provider event', async () => {
  let capturedSql = '';
  let capturedValues: readonly unknown[] = [];
  const store = new PaymentWebhookPostgresStore(mockPoolQuery((sql, values) => {
    capturedSql = sql;
    capturedValues = values ?? [];
    return { rowCount: 1, rows: [{ id: 1 }] };
  }));
  assert.equal(await store.save(evidence), 'accepted');
  assert.match(capturedSql, /on conflict do nothing/i);
  assert.equal(capturedValues[0], evidence.idempotencyKey);
  assert.equal(capturedValues[2], evidence.providerEventReference);
});

test('Postgres unique conflict is treated as duplicate without reprocessing', async () => {
  const store = new PaymentWebhookPostgresStore(mockPoolQuery(() => ({ rowCount: 0, rows: [] })));
  assert.equal(await store.save(evidence), 'duplicate');
});

test('hasProcessed checks durable idempotency state', async () => {
  const present = new PaymentWebhookPostgresStore(mockPoolQuery(() => ({ rowCount: 1, rows: [{ '?column?': 1 }] })));
  const absent = new PaymentWebhookPostgresStore(mockPoolQuery(() => ({ rowCount: 0, rows: [] })));
  assert.equal(await present.hasProcessed(evidence.idempotencyKey), true);
  assert.equal(await absent.hasProcessed(evidence.idempotencyKey), false);
});
