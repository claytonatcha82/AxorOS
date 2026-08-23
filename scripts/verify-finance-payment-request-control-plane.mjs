import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pg from 'pg';
import { createFinanceGovernedPaymentRequestService } from '../apps/api/dist/agents/finance-governed-payment-request-service.js';
import { CommercialPaymentRequirementPostgresStore } from '../apps/api/dist/data/commercial-payment-requirement-postgres-store.js';
import { FinancePaymentRequestPostgresStore } from '../apps/api/dist/data/finance-payment-request-postgres-store.js';
import { createFinanceControlPlaneRequestHandler } from '../apps/api/dist/finance-control-plane-request-handler.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
const controlPlaneToken = process.env.AXOROS_CONTROL_PLANE_TOKEN;
const controlCenterUrl = process.env.AXOROS_CONTROL_CENTER_URL ?? 'http://localhost:5173';
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}
if (!controlPlaneToken) {
  console.error('FAIL  AXOROS_CONTROL_PLANE_TOKEN is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-payment-request-control-plane-verify',
});
const requirementStore = new CommercialPaymentRequirementPostgresStore(pool);
const paymentRequestStore = new FinancePaymentRequestPostgresStore(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:payment-request-control:${suffix}`;
const requirementReference = `requirement:payment-request-control:${suffix}`;
let providerCalls = 0;

const integrations = {
  async execute(request) {
    providerCalls += 1;
    const input = request.input;
    return {
      integrationId: 'payment.paystack.request',
      operation: request.operation,
      provider: 'paystack',
      mode: request.mode,
      status: 'succeeded',
      output: {
        commercialRecordReference: input.commercialRecordReference,
        requirementReference: input.requirementReference,
        providerPaymentReference: input.providerPaymentReference,
        authorizationUrl: `https://checkout.paystack.test/${input.providerPaymentReference}`,
        accessCode: `access_${suffix}`,
      },
      externalReference: input.providerPaymentReference,
      evidenceReferences: [`payment-paystack-request:${input.providerPaymentReference}`],
      retryable: false,
    };
  },
};

const paymentRequestCommand = createFinanceGovernedPaymentRequestService({
  requirementStore,
  paymentRequestStore,
  integrations,
  mode: 'sandbox',
});
const fallback = (_request, response) => {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false }));
};
const handler = createFinanceControlPlaneRequestHandler({
  config: { controlCenterUrl, controlPlaneToken },
  financeCommand: {
    async assess() { throw new Error('assessment not used by this verifier'); },
    async bind() { throw new Error('binding not used by this verifier'); },
  },
  paymentRequestCommand,
  fallback,
});
const server = createServer(handler);

async function cleanup() {
  await pool.query('delete from finance.payment_requests where requirement_reference = $1', [requirementReference]);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1', [commercialRecordReference]);
}

async function post(baseUrl, body, token = controlPlaneToken) {
  const response = await fetch(`${baseUrl}/api/v1/control/finance/payment/request`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin: controlCenterUrl,
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

try {
  const saved = await requirementStore.save({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 12500,
    currency: 'ZAR',
    status: 'ACTIVE',
  });
  assert.equal(saved, 'accepted');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const body = {
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    recipientEmail: 'synthetic-client@example.com',
    executionId: `exec:payment-request-control:${suffix}:1`,
    correlationId: `corr:payment-request-control:${suffix}:1`,
  };

  const unauthorised = await post(baseUrl, body, 'wrong-token');
  assert.equal(unauthorised.response.status, 401);
  assert.equal(providerCalls, 0);

  const injected = await post(baseUrl, { ...body, amountMinor: 1, currency: 'USD', providerPaymentReference: 'caller-ref' });
  assert.equal(injected.response.status, 400);
  assert.equal(injected.payload.error.code, 'invalid_finance_payment_request_command');
  assert.equal(providerCalls, 0);

  const first = await post(baseUrl, body);
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.ok, true);
  assert.equal(first.payload.data.commercialRecordReference, commercialRecordReference);
  assert.equal(first.payload.data.gate, 'PRODUCTION_START');
  assert.equal(first.payload.data.requirementReference, requirementReference);
  assert.equal(first.payload.data.replayed, false);
  assert.equal(String(first.payload.data.providerPaymentReference).startsWith('AXOROS-'), true);
  assert.equal(providerCalls, 1);

  const persisted = await paymentRequestStore.get(requirementReference);
  assert.ok(persisted);
  assert.equal(persisted.amountMinor, 12500);
  assert.equal(persisted.currency, 'ZAR');
  assert.equal(persisted.providerPaymentReference, first.payload.data.providerPaymentReference);

  const replay = await post(baseUrl, {
    ...body,
    recipientEmail: 'different-recipient@example.com',
    executionId: `exec:payment-request-control:${suffix}:2`,
    correlationId: `corr:payment-request-control:${suffix}:2`,
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.data.replayed, true);
  assert.equal(replay.payload.data.providerPaymentReference, first.payload.data.providerPaymentReference);
  assert.equal(replay.payload.data.authorizationUrl, first.payload.data.authorizationUrl);
  assert.equal(providerCalls, 1);

  console.log('PASS  Authenticated Finance payment-request control plane rejects caller-supplied financial authority, derives checkout authority from persisted commercial requirements, persists it once, and replays without a second provider call.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    console.error(`WARN  verifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  await new Promise((resolve) => server.close(() => resolve())).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
