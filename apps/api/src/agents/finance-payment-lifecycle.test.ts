import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaymentWebhookEvidence, type PaymentWebhookEventType } from '../integrations/payment-webhook-evidence.js';
import { evaluateFinancePaymentLifecycle, paymentLifecycleSupportsFinanceAuthorization } from './finance-payment-lifecycle.js';

function evidence(eventType: PaymentWebhookEventType) {
  return createPaymentWebhookEvidence({
    provider: 'sandbox-gateway',
    providerEventReference: `evt-${eventType}`,
    providerPaymentReference: 'pay-lifecycle-1',
    eventType,
    commercialRecordReference: 'commercial:lifecycle:1',
    amountMinor: 125000,
    currency: 'ZAR',
    occurredAt: '2026-08-18T17:40:00.000Z',
    signatureVerified: true,
  });
}

test('verified paid provider event is the only lifecycle state that supports Finance authorization', () => {
  const state = evaluateFinancePaymentLifecycle(evidence('payment_paid'));
  assert.equal(state.paymentStatus, 'CONFIRMED');
  assert.equal(state.authorityState, 'AUTHORIZED');
  assert.equal(paymentLifecycleSupportsFinanceAuthorization(state), true);
});

test('refund and reversal invalidate payment-dependent Finance authority', () => {
  const refunded = evaluateFinancePaymentLifecycle(evidence('payment_refunded'));
  assert.equal(refunded.paymentStatus, 'REFUNDED');
  assert.equal(refunded.authorityState, 'BLOCKED');
  assert.equal(paymentLifecycleSupportsFinanceAuthorization(refunded), false);

  const reversed = evaluateFinancePaymentLifecycle(evidence('payment_reversed'));
  assert.equal(reversed.paymentStatus, 'CANCELLED');
  assert.equal(reversed.authorityState, 'BLOCKED');
  assert.equal(paymentLifecycleSupportsFinanceAuthorization(reversed), false);
});

test('chargeback blocks Finance authority and dispute requires manual review', () => {
  const chargeback = evaluateFinancePaymentLifecycle(evidence('payment_chargeback'));
  assert.equal(chargeback.paymentStatus, 'CHARGEBACK');
  assert.equal(chargeback.authorityState, 'BLOCKED');

  const disputed = evaluateFinancePaymentLifecycle(evidence('payment_disputed'));
  assert.equal(disputed.paymentStatus, 'DISPUTED');
  assert.equal(disputed.authorityState, 'MANUAL_REVIEW');
  assert.equal(paymentLifecycleSupportsFinanceAuthorization(disputed), false);
});

test('pending, failed and unknown provider events never authorize financial gates', () => {
  for (const eventType of ['payment_pending', 'payment_failed', 'unknown'] as const) {
    const state = evaluateFinancePaymentLifecycle(evidence(eventType));
    assert.equal(paymentLifecycleSupportsFinanceAuthorization(state), false);
  }
});
