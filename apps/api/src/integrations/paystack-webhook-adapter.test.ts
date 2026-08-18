import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createPaystackWebhookEnvelope, verifyPaystackWebhookSignature } from './paystack-webhook-adapter.js';

const secretKey = 'sk_test_webhook_boundary_secret';

function signed(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  return { rawBody, signature };
}

test('Paystack webhook signature verifier accepts authentic raw body and rejects tampering', () => {
  const request = signed({ event: 'charge.success', data: { id: 1, reference: 'pay:1' } });
  assert.equal(verifyPaystackWebhookSignature({ ...request, secretKey }), true);
  assert.equal(verifyPaystackWebhookSignature({ rawBody: `${request.rawBody} `, signature: request.signature, secretKey }), false);
  assert.equal(verifyPaystackWebhookSignature({ rawBody: request.rawBody, signature: '0'.repeat(128), secretKey }), false);
});

test('charge.success becomes trusted payment_paid envelope using AxorOS metadata', async () => {
  const request = signed({
    event: 'charge.success',
    data: {
      id: 712345,
      status: 'success',
      reference: 'paystack-ref-1',
      amount: 125000,
      currency: 'ZAR',
      paid_at: '2026-08-18T18:40:00.000Z',
      metadata: { axorosCommercialRecordReference: 'commercial:paystack:1' },
    },
  });

  const envelope = await createPaystackWebhookEnvelope({ secretKey }, request);
  assert.deepEqual(envelope, {
    provider: 'paystack',
    providerEventReference: 'charge.success:paystack-ref-1',
    providerPaymentReference: 'paystack-ref-1',
    eventType: 'payment_paid',
    commercialRecordReference: 'commercial:paystack:1',
    amountMinor: 125000,
    currency: 'ZAR',
    occurredAt: '2026-08-18T18:40:00.000Z',
    signatureVerified: true,
  });
});

test('refund.processed resolves original transaction and becomes payment_refunded', async () => {
  const request = signed({
    event: 'refund.processed',
    data: {
      id: 9988,
      transaction_reference: 'paystack-ref-refund',
      refund_reference: 'refund-ref-1',
      amount: '50000',
      currency: 'ZAR',
      updated_at: '2026-08-18T19:00:00.000Z',
    },
  });

  const envelope = await createPaystackWebhookEnvelope({
    secretKey,
    async resolveCommercialRecordReference(reference) {
      return reference === 'paystack-ref-refund' ? 'commercial:refund:1' : null;
    },
  }, request);

  assert.equal(envelope.providerEventReference, 'refund.processed:refund-ref-1');
  assert.equal(envelope.providerPaymentReference, 'paystack-ref-refund');
  assert.equal(envelope.eventType, 'payment_refunded');
  assert.equal(envelope.commercialRecordReference, 'commercial:refund:1');
  assert.equal(envelope.amountMinor, 50000);
});

test('charge.dispute.create becomes payment_disputed and uses nested transaction reference', async () => {
  const request = signed({
    event: 'charge.dispute.create',
    data: {
      id: 445566,
      amount: 75000,
      currency: 'ZAR',
      created_at: '2026-08-18T19:10:00.000Z',
      transaction: { reference: 'paystack-ref-dispute' },
    },
  });

  const envelope = await createPaystackWebhookEnvelope({
    secretKey,
    async resolveCommercialRecordReference() { return 'commercial:dispute:1'; },
  }, request);
  assert.equal(envelope.providerEventReference, 'charge.dispute.create:445566');
  assert.equal(envelope.eventType, 'payment_disputed');
  assert.equal(envelope.providerPaymentReference, 'paystack-ref-dispute');
});

test('unsupported signed Paystack event normalizes to unknown rather than inventing financial meaning', async () => {
  const request = signed({
    event: 'charge.dispute.resolve',
    data: {
      id: 1,
      created_at: '2026-08-18T19:20:00.000Z',
      transaction: { reference: 'paystack-ref-resolved' },
    },
  });
  const envelope = await createPaystackWebhookEnvelope({
    secretKey,
    async resolveCommercialRecordReference() { return 'commercial:resolved:1'; },
  }, request);
  assert.equal(envelope.eventType, 'unknown');
});

test('invalid signature is rejected before payload normalization or commercial resolution', async () => {
  let resolverCalls = 0;
  await assert.rejects(() => createPaystackWebhookEnvelope({
    secretKey,
    async resolveCommercialRecordReference() { resolverCalls += 1; return 'commercial:any'; },
  }, {
    rawBody: JSON.stringify({ event: 'charge.success', data: { reference: 'pay:forged' } }),
    signature: '0'.repeat(128),
  }), /signature verification failed/);
  assert.equal(resolverCalls, 0);
});

test('signed webhook fails closed when commercial record cannot be resolved', async () => {
  const request = signed({
    event: 'refund.processed',
    data: {
      id: 3,
      transaction_reference: 'paystack-ref-orphan',
      amount: 10000,
      currency: 'ZAR',
      updated_at: '2026-08-18T19:30:00.000Z',
    },
  });
  await assert.rejects(() => createPaystackWebhookEnvelope({ secretKey }, request), /could not resolve/);
});
