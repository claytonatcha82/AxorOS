import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FinancePaymentCurrentStateIntegrityConflictError,
  FinancePaymentCurrentStatePostgresStore,
} from './finance-payment-current-state-postgres-store.js';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';

function evidence(overrides: Partial<PaymentWebhookEvidence> = {}): PaymentWebhookEvidence {
  return {
    idempotencyKey: 'payment-webhook:test:event-1',
    provider: 'test',
    providerEventReference: 'event-1',
    providerPaymentReference: 'payment-1',
    eventType: 'payment_paid',
    commercialRecordReference: 'commercial-1',
    amountMinor: 1000,
    currency: 'ZAR',
    occurredAt: '2026-08-18T10:00:00.000Z',
    evidenceReference: 'payment-provider:test:event-1',
    ...overrides,
  };
}

function fakeDatabase() {
  let row: Record<string, unknown> | null = null;
  return {
    async query(sql: string, params: unknown[]) {
      if (sql.includes('select provider')) return { rows: row ? [row] : [] };
      const incoming = {
        provider: params[0],
        provider_payment_reference: params[1],
        commercial_record_reference: params[2],
        payment_status: params[3],
        authority_state: params[4],
        reason: params[5],
        latest_event_type: params[6],
        latest_provider_event_reference: params[7],
        latest_evidence_reference: params[8],
        latest_occurred_at: params[9],
        amount_minor: params[10],
        currency: params[11],
      };
      if (!row || Date.parse(String(incoming.latest_occurred_at)) > Date.parse(String(row.latest_occurred_at))) {
        row = incoming;
        return { rows: [{ provider: params[0] }] };
      }
      return { rows: [] };
    },
  };
}

test('paid evidence creates authorized current payment state', async () => {
  const store = new FinancePaymentCurrentStatePostgresStore(fakeDatabase());
  assert.equal(await store.apply(evidence()), 'accepted');
  const persisted = await store.get('test', 'payment-1');
  assert.equal(persisted?.paymentStatus, 'CONFIRMED');
  assert.equal(persisted?.authorityState, 'AUTHORIZED');
});

test('newer adverse event supersedes paid authority', async () => {
  const store = new FinancePaymentCurrentStatePostgresStore(fakeDatabase());
  await store.apply(evidence());
  assert.equal(await store.apply(evidence({
    providerEventReference: 'event-2',
    eventType: 'payment_chargeback',
    evidenceReference: 'payment-provider:test:event-2',
    occurredAt: '2026-08-18T11:00:00.000Z',
  })), 'accepted');
  const persisted = await store.get('test', 'payment-1');
  assert.equal(persisted?.paymentStatus, 'CHARGEBACK');
  assert.equal(persisted?.authorityState, 'BLOCKED');
});

test('older out-of-order event is stale and cannot restore authority', async () => {
  const store = new FinancePaymentCurrentStatePostgresStore(fakeDatabase());
  await store.apply(evidence({
    providerEventReference: 'event-2',
    eventType: 'payment_refunded',
    evidenceReference: 'payment-provider:test:event-2',
    occurredAt: '2026-08-18T11:00:00.000Z',
  }));
  assert.equal(await store.apply(evidence({ occurredAt: '2026-08-18T10:00:00.000Z' })), 'stale');
  assert.equal((await store.get('test', 'payment-1'))?.paymentStatus, 'REFUNDED');
});

test('exact same-timestamp replay is duplicate', async () => {
  const store = new FinancePaymentCurrentStatePostgresStore(fakeDatabase());
  await store.apply(evidence());
  assert.equal(await store.apply(evidence()), 'duplicate');
});

test('conflicting same-timestamp evidence fails closed', async () => {
  const store = new FinancePaymentCurrentStatePostgresStore(fakeDatabase());
  await store.apply(evidence());
  await assert.rejects(
    () => store.apply(evidence({
      providerEventReference: 'event-conflict',
      eventType: 'payment_refunded',
      evidenceReference: 'payment-provider:test:event-conflict',
    })),
    FinancePaymentCurrentStateIntegrityConflictError,
  );
});
