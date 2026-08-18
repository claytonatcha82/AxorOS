import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createPaystackPaymentWebhookIngress } from './agents/paystack-payment-webhook-ingress.js';
import type { PaymentWebhookEnvelope } from './integrations/payment-webhook-evidence.js';
import { createPaystackWebhookRequestHandler } from './paystack-webhook-request-handler.js';

async function withServer(handler: ReturnType<typeof createPaystackWebhookRequestHandler>, run: (port: number) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(port: number, body: Buffer, signature: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/api/v1/webhooks/paystack',
      method: 'POST',
      headers: {
        'content-length': body.length,
        'content-type': 'application/json',
        'x-paystack-signature': signature,
      },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('signed raw Paystack HTTP webhook reaches Finance event workflow as a trusted normalized envelope', async () => {
  const secretKey = 'sk_test_http_e2e_secret';
  const body = Buffer.from(JSON.stringify({
    event: 'charge.success',
    data: {
      id: 701,
      reference: 'paystack-http-e2e-1',
      amount: 12500,
      currency: 'ZAR',
      paid_at: '2026-08-18T18:55:00.000Z',
      metadata: { axorosCommercialRecordReference: 'commercial:http-e2e:1' },
    },
  }));
  const signature = createHmac('sha512', secretKey).update(body).digest('hex');
  let captured: PaymentWebhookEnvelope | undefined;

  const ingress = createPaystackPaymentWebhookIngress({
    secretKey,
    currentStateStore: { async get() { return null; } },
    eventWorkflow: {
      async ingest(envelope) {
        captured = envelope;
        return {
          evidence: {
            idempotencyKey: `payment-webhook:${envelope.provider}:${envelope.providerEventReference}`,
            provider: envelope.provider,
            providerEventReference: envelope.providerEventReference,
            providerPaymentReference: envelope.providerPaymentReference,
            eventType: envelope.eventType,
            commercialRecordReference: envelope.commercialRecordReference,
            ...(envelope.amountMinor !== undefined ? { amountMinor: envelope.amountMinor } : {}),
            ...(envelope.currency !== undefined ? { currency: envelope.currency } : {}),
            occurredAt: envelope.occurredAt,
            evidenceReference: `payment-provider:${envelope.provider}:${envelope.providerEventReference}`,
          },
          webhookPersistence: 'accepted',
          currentStatePersistence: 'not_applied',
        };
      },
    },
  });

  const handler = createPaystackWebhookRequestHandler({
    config: { paystackSecretKey: secretKey },
    ingress,
    fallback: (_request, response) => { response.writeHead(404); response.end(); },
  });

  await withServer(handler, async (port) => {
    assert.equal(await post(port, body, signature), 204);
  });

  assert.ok(captured);
  assert.equal(captured.signatureVerified, true);
  assert.equal(captured.provider, 'paystack');
  assert.equal(captured.providerPaymentReference, 'paystack-http-e2e-1');
  assert.equal(captured.eventType, 'payment_paid');
  assert.equal(captured.commercialRecordReference, 'commercial:http-e2e:1');
  assert.equal(captured.amountMinor, 12500);
  assert.equal(captured.currency, 'ZAR');
});
