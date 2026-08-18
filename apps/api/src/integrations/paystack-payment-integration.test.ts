import assert from 'node:assert/strict';
import test from 'node:test';
import type { IntegrationRequest } from './integration-contract.js';
import type { PaymentVerificationInput } from './payment-integration.js';
import { createPaystackPaymentIntegration } from './paystack-payment-integration.js';

function request(overrides: Partial<IntegrationRequest<PaymentVerificationInput>> = {}): IntegrationRequest<PaymentVerificationInput> {
  return {
    integrationId: 'payment.paystack',
    operation: 'verify_payment',
    requestedBy: 'finance_agent',
    executionId: 'exec-paystack-1',
    correlationId: 'corr-paystack-1',
    mode: 'sandbox',
    risk: 'high',
    idempotencyKey: 'finance-payment-verification:paystack:test:1',
    input: {
      providerPaymentReference: 'ref_test_1',
      expectedAmountMinor: 25000,
      currency: 'ZAR',
      commercialRecordReference: 'commercial:test:1',
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Paystack adapter verifies a successful sandbox payment using only the verify endpoint', async () => {
  let requestedUrl = '';
  let authorization = '';
  const integration = createPaystackPaymentIntegration({
    secretKey: 'sk_test_example-secret',
    fetchImpl: (async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return jsonResponse({
        status: true,
        message: 'Verification successful',
        data: {
          id: 123456789,
          status: 'success',
          reference: 'ref_test_1',
          amount: 25000,
          currency: 'ZAR',
          paid_at: '2026-08-18T18:00:00.000Z',
        },
      });
    }) as typeof fetch,
  });

  const result = await integration.execute(request());

  assert.equal(requestedUrl, 'https://api.paystack.co/transaction/verify/ref_test_1');
  assert.equal(authorization, 'Bearer sk_test_example-secret');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.verificationStatus, 'verified_paid');
  assert.equal(result.output.amountMinor, 25000);
  assert.equal(result.output.currency, 'ZAR');
  assert.equal(result.output.providerEventReference, 'transaction:123456789');
  assert.equal(result.output.verifiedAt, '2026-08-18T18:00:00.000Z');
  assert.deepEqual(result.evidenceReferences, ['payment-paystack-verify:transaction:123456789:ref_test_1']);
});

test('Paystack adapter maps pending states to non-authorizing pending verification', async () => {
  const integration = createPaystackPaymentIntegration({
    secretKey: 'sk_test_example-secret',
    fetchImpl: (async () => jsonResponse({
      status: true,
      data: {
        id: 22,
        status: 'pending',
        reference: 'ref_test_1',
        amount: 25000,
        currency: 'ZAR',
        created_at: '2026-08-18T18:00:00.000Z',
      },
    })) as typeof fetch,
  });

  const result = await integration.execute(request());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.verificationStatus, 'pending');
});

test('Paystack adapter treats ambiguous reversed verification as unknown rather than authorizing it', async () => {
  const integration = createPaystackPaymentIntegration({
    secretKey: 'sk_test_example-secret',
    fetchImpl: (async () => jsonResponse({
      status: true,
      data: {
        id: 33,
        status: 'reversed',
        reference: 'ref_test_1',
        amount: 25000,
        currency: 'ZAR',
        created_at: '2026-08-18T18:00:00.000Z',
      },
    })) as typeof fetch,
  });

  const result = await integration.execute(request());
  assert.equal(result.output.verificationStatus, 'unknown');
});

test('Paystack adapter blocks callers other than Finance Agent before provider access', async () => {
  let calls = 0;
  const integration = createPaystackPaymentIntegration({
    secretKey: 'sk_test_example-secret',
    fetchImpl: (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });

  const result = await integration.execute(request({ requestedBy: 'sales_agent' }));
  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('Paystack adapter blocks test/live mode mismatches before provider access', async () => {
  let calls = 0;
  const integration = createPaystackPaymentIntegration({
    secretKey: 'sk_test_example-secret',
    fetchImpl: (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });

  const result = await integration.execute(request({ mode: 'live' }));
  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('Paystack adapter marks network failures as retryable without inventing evidence', async () => {
  const integration = createPaystackPaymentIntegration({
    secretKey: 'sk_test_example-secret',
    fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as typeof fetch,
  });

  const result = await integration.execute(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.output.verificationStatus, 'unknown');
  assert.deepEqual(result.evidenceReferences, []);
});

test('Paystack adapter rejects keys that are not explicit Paystack test/live secret keys', () => {
  assert.throws(
    () => createPaystackPaymentIntegration({ secretKey: 'not-a-paystack-secret' }),
    /test or live secret key/,
  );
});
