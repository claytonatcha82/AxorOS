import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaymentWebhookEvidence, PaymentWebhookIdempotencyGuard, validatePaymentWebhookEnvelope } from './payment-webhook-evidence.js';

const event = {
  provider: 'sandbox-gateway', providerEventReference: 'evt_001', providerPaymentReference: 'pay_001', eventType: 'payment_paid' as const,
  commercialRecordReference: 'commercial:test:1', amountMinor: 125000, currency: 'ZAR', occurredAt: '2026-08-17T21:23:00.000Z', signatureVerified: true,
};

test('verified provider webhook becomes bounded payment evidence with provider event idempotency key', () => {
  const evidence = createPaymentWebhookEvidence(event);
  assert.equal(evidence.idempotencyKey, 'payment-webhook:sandbox-gateway:evt_001');
  assert.equal(evidence.evidenceReference, 'payment-provider:sandbox-gateway:evt_001');
  assert.equal(evidence.amountMinor, 125000);
  assert.equal(evidence.currency, 'ZAR');
});

test('unverified webhook signature is rejected before evidence ingestion', () => {
  const unsigned = { ...event, signatureVerified: false };
  assert.deepEqual(validatePaymentWebhookEnvelope(unsigned), ['provider webhook signature must be verified before ingestion.']);
  assert.throws(() => createPaymentWebhookEvidence(unsigned), /signature must be verified/);
});

test('duplicate provider event is idempotently ignored', () => {
  const evidence = createPaymentWebhookEvidence(event);
  const guard = new PaymentWebhookIdempotencyGuard();
  assert.equal(guard.accept(evidence), 'accepted');
  assert.equal(guard.accept(evidence), 'duplicate');
});

test('different provider event references remain distinct even for the same payment', () => {
  const first = createPaymentWebhookEvidence(event);
  const second = createPaymentWebhookEvidence({ ...event, providerEventReference: 'evt_002', eventType: 'payment_refunded' });
  const guard = new PaymentWebhookIdempotencyGuard();
  assert.equal(guard.accept(first), 'accepted');
  assert.equal(guard.accept(second), 'accepted');
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('invalid amount, currency, timestamp, or missing references are rejected', () => {
  const errors = validatePaymentWebhookEnvelope({ ...event, provider: '', providerEventReference: '', providerPaymentReference: '', commercialRecordReference: '', amountMinor: 0, currency: 'zar', occurredAt: 'not-a-date' });
  assert.ok(errors.length >= 7);
});
