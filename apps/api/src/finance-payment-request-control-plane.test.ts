import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createFinanceControlPlaneRequestHandler } from './finance-control-plane-request-handler.js';

test('Finance payment-request control plane authenticates, rejects caller authority, and returns internal checkout authority', async () => {
  let paymentRequestCalls = 0;
  const handler = createFinanceControlPlaneRequestHandler({
    config: { controlCenterUrl: 'http://localhost:5173', controlPlaneToken: 'finance-control-token' },
    financeCommand: {
      async assess(input) {
        return { decision: { commercialRecordReference: input.commercialRecordReference, gate: input.gate, state: 'AWAITING_VERIFIED_PAYMENT', reason: 'test' }, auditEventReference: 'workflow-event:test' };
      },
      async bind() {
        return { before: { state: 'READY_TO_BIND_REQUIREMENT' }, beforeAuditEventReference: 'workflow-event:before', clearanceId: 'clearance:test', satisfactionPersistence: 'accepted', after: { state: 'REQUIREMENT_SATISFIED' }, afterAuditEventReference: 'workflow-event:after' };
      },
    },
    paymentRequestCommand: {
      async initialize(input) {
        paymentRequestCalls += 1;
        return {
          requirement: {
            commercialRecordReference: input.commercialRecordReference,
            gate: input.gate,
            requirementReference: 'requirement:test',
            requirementType: 'DEPOSIT',
            requiredAmountMinor: 12500,
            currency: 'ZAR',
            status: 'ACTIVE',
          },
          providerPaymentReference: 'AXOROS-TEST',
          authorizationUrl: 'https://checkout.paystack.test/AXOROS-TEST',
          evidenceReferences: ['payment-paystack-request:AXOROS-TEST'],
          replayed: false,
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
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const body = {
      commercialRecordReference: 'commercial:test',
      gate: 'PRODUCTION_START',
      recipientEmail: 'client@example.com',
      executionId: 'exec:test',
      correlationId: 'corr:test',
    };

    const unauthorised = await fetch(`${baseUrl}/api/v1/control/finance/payment/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(unauthorised.status, 401);
    assert.equal(paymentRequestCalls, 0);

    const injectedAuthority = await fetch(`${baseUrl}/api/v1/control/finance/payment/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer finance-control-token', 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ ...body, amountMinor: 1 }),
    });
    assert.equal(injectedAuthority.status, 400);
    assert.equal(paymentRequestCalls, 0);

    const accepted = await fetch(`${baseUrl}/api/v1/control/finance/payment/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer finance-control-token', 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify(body),
    });
    assert.equal(accepted.status, 200);
    const payload = await accepted.json() as { data: { requirementReference: string; providerPaymentReference: string; authorizationUrl: string; replayed: boolean } };
    assert.equal(payload.data.requirementReference, 'requirement:test');
    assert.equal(payload.data.providerPaymentReference, 'AXOROS-TEST');
    assert.equal(payload.data.authorizationUrl, 'https://checkout.paystack.test/AXOROS-TEST');
    assert.equal(payload.data.replayed, false);
    assert.equal(paymentRequestCalls, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
