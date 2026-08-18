import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PaymentWebhookIntegrityConflictError, PaymentWebhookPostgresStore } from './payment-webhook-postgres-store.js';
import { createPaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';

const evidence = createPaymentWebhookEvidence({
  provider: 'sandbox-gateway', providerEventReference: 'evt_001', providerPaymentReference: 'pay_001', eventType: 'payment_paid',
  commercialRecordReference: 'commercial:test:1', amountMinor: 125000, currency: 'ZAR', occurredAt: '2026-08-17T21:25:00.000Z', signatureVerified: true,
});

const persistedEvidence = {
  idempotency_key: evidence.idempotencyKey,
  provider: evidence.provider,
  provider_event_reference: evidence.providerEventReference,
  provider_payment_reference: evidence.providerPaymentReference,
  event_type: evidence.eventType,
  commercial_record_reference: evidence.commercialRecordReference,
  amount_minor: evidence.amountMinor ?? null,
  currency: evidence.currency ?? null,
  occurred_at: evidence.occurredAt,
  evidence_reference: evidence.evidenceReference,
};

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

test('authoritative persisted payment webhook evidence can be reloaded by idempotency key', async () => {
  const store = new PaymentWebhookPostgresStore(mockPoolQuery(() => ({ rowCount: 1, rows: [persistedEvidence] })));
  assert.deepEqual(await store.get(evidence.idempotencyKey), evidence);
});

test('exact Postgres unique conflict is treated as duplicate without reprocessing', async () => {
  let call = 0;
  const store = new PaymentWebhookPostgresStore(mockPoolQuery(() => {
    call += 1;
    return call === 1
      ? { rowCount: 0, rows: [] }
      : { rowCount: 1, rows: [persistedEvidence] };
  }));
  assert.equal(await store.save(evidence), 'duplicate');
});

test('conflicting Postgres duplicate is rejected as an integrity conflict', async () => {
  let call = 0;
  const store = new PaymentWebhookPostgresStore(mockPoolQuery(() => {
    call += 1;
    return call === 1
      ? { rowCount: 0, rows: [] }
      : { rowCount: 1, rows: [{ ...persistedEvidence, amount_minor: 999 }] };
  }));
  await assert.rejects(() => store.save(evidence), PaymentWebhookIntegrityConflictError);
});

test('missing persisted row after a reported conflict is rejected as an integrity conflict', async () => {
  const store = new PaymentWebhookPostgresStore(mockPoolQuery(() => ({ rowCount: 0, rows: [] })));
  await assert.rejects(() => store.save(evidence), PaymentWebhookIntegrityConflictError);
});

test('hasProcessed checks durable idempotency state', async () => {
  const present = new PaymentWebhookPostgresStore(mockPoolQuery(() => ({ rowCount: 1, rows: [{ '?column?': 1 }] })));
  const absent = new PaymentWebhookPostgresStore(mockPoolQuery(() => ({ rowCount: 0, rows: [] })));
  assert.equal(await present.hasProcessed(evidence.idempotencyKey), true);
  assert.equal(await absent.hasProcessed(evidence.idempotencyKey), false);
});
