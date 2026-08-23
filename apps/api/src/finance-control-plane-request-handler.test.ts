import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createFinanceControlPlaneRequestHandler } from './finance-control-plane-request-handler.js';

async function withServer(run: (baseUrl: string, calls: { assess: number; bind: number }) => Promise<void>) {
  const calls = { assess: 0, bind: 0 };
  const handler = createFinanceControlPlaneRequestHandler({
    config: { controlCenterUrl: 'http://localhost:5173', controlPlaneToken: 'finance-control-token' },
    financeCommand: {
      async assess(input) {
        calls.assess += 1;
        return {
          decision: {
            commercialRecordReference: input.commercialRecordReference,
            gate: input.gate,
            state: 'AWAITING_VERIFIED_PAYMENT',
            reason: 'No verified payment evidence exists.',
          },
          auditEventReference: 'workflow-event:assessment:1',
        };
      },
      async bind() {
        calls.bind += 1;
        return {
          before: { state: 'READY_TO_BIND_REQUIREMENT' },
          beforeAuditEventReference: 'workflow-event:before:1',
          clearanceId: 'finance-clearance:control:generated',
          satisfactionPersistence: 'accepted',
          after: { state: 'REQUIREMENT_SATISFIED' },
          afterAuditEventReference: 'workflow-event:after:1',
        };
      },
    },
    fallback: (_request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false }));
    },
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function headers(token = 'finance-control-token') {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
  };
}

test('Finance control assessment requires authentication and accepts identifier-only input', async () => {
  await withServer(async (baseUrl, calls) => {
    const unauthorised = await fetch(`${baseUrl}/api/v1/control/finance/payment/assess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commercialRecordReference: 'commercial:1', gate: 'PRODUCTION_START', provider: 'paystack', providerPaymentReference: 'pay:1' }),
    });
    assert.equal(unauthorised.status, 401);
    assert.equal(calls.assess, 0);

    const response = await fetch(`${baseUrl}/api/v1/control/finance/payment/assess`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ commercialRecordReference: 'commercial:1', gate: 'PRODUCTION_START', provider: 'paystack', providerPaymentReference: 'pay:1' }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { data: { state: string; auditEventReference: string } };
    assert.equal(payload.data.state, 'AWAITING_VERIFIED_PAYMENT');
    assert.equal(payload.data.auditEventReference, 'workflow-event:assessment:1');
    assert.equal(calls.assess, 1);
  });
});

test('Finance control binding rejects caller-supplied authority fields before command execution', async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/v1/control/finance/payment/bind`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        commercialRecordReference: 'commercial:1',
        gate: 'PRODUCTION_START',
        provider: 'paystack',
        providerPaymentReference: 'pay:1',
        trustedPaymentWebhookIdempotencyKey: 'payment-webhook:paystack:event:1',
        clearanceId: 'caller-supplied-clearance',
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls.bind, 0);
    const payload = await response.json() as { error: { code: string } };
    assert.equal(payload.error.code, 'invalid_finance_binding_command');
  });
});
