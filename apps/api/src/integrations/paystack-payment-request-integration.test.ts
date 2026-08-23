import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaystackPaymentRequestIntegration } from './paystack-payment-request-integration.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    integrationId: 'payment.paystack.request',
    operation: 'initialize_payment_request',
    requestedBy: 'finance_agent' as const,
    executionId: 'exec:test:1',
    correlationId: 'corr:test:1',
    mode: 'sandbox' as const,
    risk: 'medium' as const,
    idempotencyKey: 'payment-request:test:1',
    input: {
      commercialRecordReference: 'commercial:test:1',
      requirementReference: 'deposit:commercial:test:1',
      providerPaymentReference: 'AXOROS-TEST-1',
      recipientEmail: 'client@example.com',
      amountMinor: 10000,
      currency: 'ZAR',
    },
    ...overrides,
  };
}

test('Paystack payment request integration initializes a provider-hosted payment page for Finance', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const integration = createPaystackPaymentRequestIntegration({
    secretKey: 'sk_test_example',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.test/abc',
          access_code: 'abc',
          reference: 'AXOROS-TEST-1',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  const response = await integration.execute(request());
  assert.equal(response.status, 'succeeded');
  assert.equal(response.output.authorizationUrl, 'https://checkout.paystack.test/abc');
  assert.equal(response.output.accessCode, 'abc');
  assert.deepEqual(response.evidenceReferences, ['payment-paystack-request:AXOROS-TEST-1']);
  assert.equal(capturedUrl, 'https://api.paystack.co/transaction/initialize');
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.email, 'client@example.com');
  assert.equal(body.amount, 10000);
  assert.equal(body.currency, 'ZAR');
  assert.equal(body.reference, 'AXOROS-TEST-1');
  assert.equal(body.metadata.commercialRecordReference, 'commercial:test:1');
  assert.equal(body.metadata.requirementReference, 'deposit:commercial:test:1');
});

test('Paystack payment request integration rejects non-Finance callers and mode mismatch before provider execution', async () => {
  let calls = 0;
  const integration = createPaystackPaymentRequestIntegration({
    secretKey: 'sk_test_example',
    fetchImpl: (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });

  const wrongCaller = await integration.execute(request({ requestedBy: 'sales_agent' }));
  assert.equal(wrongCaller.status, 'blocked');
  const wrongMode = await integration.execute(request({ mode: 'live' }));
  assert.equal(wrongMode.status, 'blocked');
  assert.equal(calls, 0);
});

test('Paystack payment request integration fails closed when provider response lacks checkout authority', async () => {
  const integration = createPaystackPaymentRequestIntegration({
    secretKey: 'sk_test_example',
    fetchImpl: (async () => new Response(JSON.stringify({ status: true, data: { reference: 'AXOROS-TEST-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
  });
  const response = await integration.execute(request());
  assert.equal(response.status, 'failed');
  assert.deepEqual(response.evidenceReferences, []);
});
