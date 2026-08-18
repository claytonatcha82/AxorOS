import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createPaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';
import { createPaystackPaymentWebhookIngress } from './paystack-payment-webhook-ingress.js';

const secretKey = 'sk_test_paystack_ingress_secret';

function signed(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    signature: createHmac('sha512', secretKey).update(rawBody).digest('hex'),
  };
}

test('Paystack ingress resolves adverse event to authoritative commercial record and delegates to Finance event workflow', async () => {
  let currentStateReads = 0;
  let workflowCalls = 0;
  const ingress = createPaystackPaymentWebhookIngress({
    secretKey,
    currentStateStore: {
      async get(provider, providerPaymentReference) {
        currentStateReads += 1;
        assert.equal(provider, 'paystack');
        assert.equal(providerPaymentReference, 'paystack-ref-1');
        return {
          provider: 'paystack',
          providerPaymentReference,
          commercialRecordReference: 'commercial:paystack:1',
          paymentStatus: 'CONFIRMED',
          authorityState: 'AUTHORIZED',
          reason: 'fixture',
          latestEventType: 'payment_paid',
          latestProviderEventReference: 'charge.success:paystack-ref-1',
          latestEvidenceReference: 'payment-provider:paystack:charge.success:paystack-ref-1',
          latestOccurredAt: '2026-08-18T18:40:00.000Z',
          amountMinor: 10000,
          currency: 'ZAR',
        };
      },
    },
    eventWorkflow: {
      async ingest(envelope) {
        workflowCalls += 1;
        assert.equal(envelope.eventType, 'payment_refunded');
        assert.equal(envelope.commercialRecordReference, 'commercial:paystack:1');
        const evidence = createPaymentWebhookEvidence(envelope);
        return {
          evidence,
          webhookPersistence: 'accepted',
          currentStatePersistence: 'accepted',
        };
      },
    },
  });

  const result = await ingress.ingest(signed({
    event: 'refund.processed',
    data: {
      id: 10,
      transaction_reference: 'paystack-ref-1',
      refund_reference: 'refund-1',
      amount: 10000,
      currency: 'ZAR',
      updated_at: '2026-08-18T19:00:00.000Z',
    },
  }));

  assert.equal(currentStateReads, 1);
  assert.equal(workflowCalls, 1);
  assert.equal(result.evidence.provider, 'paystack');
  assert.equal(result.evidence.eventType, 'payment_refunded');
});

test('Paystack ingress does not query Finance state or invoke workflow when signature is forged', async () => {
  let currentStateReads = 0;
  let workflowCalls = 0;
  const ingress = createPaystackPaymentWebhookIngress({
    secretKey,
    currentStateStore: {
      async get() { currentStateReads += 1; return null; },
    },
    eventWorkflow: {
      async ingest() {
        workflowCalls += 1;
        throw new Error('should not be called');
      },
    },
  });

  await assert.rejects(() => ingress.ingest({
    rawBody: JSON.stringify({ event: 'refund.processed', data: { transaction_reference: 'paystack-ref-1' } }),
    signature: '0'.repeat(128),
  }), /signature verification failed/);
  assert.equal(currentStateReads, 0);
  assert.equal(workflowCalls, 0);
});
