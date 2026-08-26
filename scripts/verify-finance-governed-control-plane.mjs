import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pg from 'pg';
import { createFinanceGovernedControlCommand } from '../apps/api/dist/agents/finance-governed-control-command.js';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { createFinanceControlPlaneRequestHandler } from '../apps/api/dist/finance-control-plane-request-handler.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({
  connectionString,
  application_name: 'axoros-finance-governed-control-plane-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const controlPlaneToken = `finance-control-token:${suffix}`;
const controlCenterUrl = 'http://localhost:5173';
const commercialRecordReference = `commercial:finance-control:${suffix}`;
const requirementReference = `requirement:finance-control:${suffix}`;
const provider = 'paystack';
const providerEventReference = `paystack-event:${suffix}`;
const occurredAt = new Date().toISOString();
const amountMinor = 12500;
const currency = 'ZAR';

function headers(token = controlPlaneToken) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    origin: controlCenterUrl,
  };
}

async function post(baseUrl, path, body, requestHeaders = headers()) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

try {
  await client.connect();
  await client.query('begin');

  const integrations = new IntegrationRegistry();
  integrations.register({
    integrationId: 'payment.paystack.request',
    kind: 'payment',
    provider: 'paystack',
    supportedModes: ['sandbox'],
    supportedOperations: ['initialize_payment_request'],
    async execute(request) {
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
        evidenceReferences: [input.requirementReference, `payment-paystack-request:${input.providerPaymentReference}`],
        retryable: false,
      };
    },
  });
  integrations.register({
    integrationId: 'payment.sandbox',
    kind: 'payment',
    provider: 'sandbox',
    supportedModes: ['sandbox'],
    supportedOperations: ['verify_payment'],
    async execute(request) {
      const input = request.input;
      return {
        integrationId: 'payment.sandbox',
        operation: request.operation,
        provider: 'sandbox',
        mode: request.mode,
        status: 'succeeded',
        output: {
          providerPaymentReference: input.providerPaymentReference,
          commercialRecordReference: input.commercialRecordReference,
          verificationStatus: 'verified_paid',
          amountMinor: input.expectedAmountMinor,
          currency: input.currency,
          providerEventReference,
          verifiedAt: occurredAt,
        },
        externalReference: input.providerPaymentReference,
        evidenceReferences: [`payment-sandbox:${providerEventReference}`],
        retryable: false,
      };
    },
  });

  const runtime = createFinancePaymentRuntime({
    pool: client,
    integrations,
    paymentIntegrationId: 'payment.sandbox',
    mode: 'sandbox',
  });

  const requirementPersistence = await runtime.requirementStore.save({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: amountMinor,
    currency,
    status: 'ACTIVE',
  });
  assert.equal(requirementPersistence, 'accepted');

  const checkout = await runtime.governedPaymentRequestService.initialize({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    recipientEmail: 'synthetic-client@example.com',
    executionId: `exec:finance-control:${suffix}:checkout`,
    correlationId: `corr:finance-control:${suffix}:checkout`,
  });
  assert.equal(checkout.replayed, false);
  const providerPaymentReference = checkout.providerPaymentReference;
  const webhookIdempotencyKey = `payment-webhook:${provider}:${providerEventReference}`;

  const ingested = await runtime.eventWorkflow.ingest({
    provider,
    providerEventReference,
    providerPaymentReference,
    eventType: 'payment_paid',
    commercialRecordReference,
    amountMinor,
    currency,
    occurredAt,
    signatureVerified: true,
  });
  assert.equal(ingested.evidence.idempotencyKey, webhookIdempotencyKey);

  const financeCommand = createFinanceGovernedControlCommand({
    operationalRuntime: runtime.governedOperationalRuntime,
    bindingService: runtime.governedBindingService,
    paymentWebhookEvidenceStore: runtime.webhookStore,
  });
  const fallback = (_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false }));
  };
  const handler = createFinanceControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken },
    financeCommand,
    fallback,
  });
  const server = createServer(handler);

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const identifiers = {
      commercialRecordReference,
      gate: 'PRODUCTION_START',
      provider,
      providerPaymentReference,
    };

    const unauthorised = await post(
      baseUrl,
      '/api/v1/control/finance/payment/assess',
      identifiers,
      { 'content-type': 'application/json', origin: controlCenterUrl },
    );
    assert.equal(unauthorised.response.status, 401);

    const assessed = await post(baseUrl, '/api/v1/control/finance/payment/assess', identifiers);
    assert.equal(assessed.response.status, 200);
    assert.equal(assessed.payload.ok, true);
    assert.equal(assessed.payload.data.state, 'READY_TO_BIND_REQUIREMENT');
    assert.match(String(assessed.payload.data.auditEventReference), /^workflow-event:/);

    const callerAuthority = await post(baseUrl, '/api/v1/control/finance/payment/bind', {
      ...identifiers,
      trustedPaymentWebhookIdempotencyKey: webhookIdempotencyKey,
      clearanceId: 'caller-supplied-clearance',
    });
    assert.equal(callerAuthority.response.status, 400);
    assert.equal(callerAuthority.payload.error.code, 'invalid_finance_binding_command');
    assert.equal(await runtime.satisfactionStore.get(requirementReference), null);

    const bound = await post(baseUrl, '/api/v1/control/finance/payment/bind', {
      ...identifiers,
      trustedPaymentWebhookIdempotencyKey: webhookIdempotencyKey,
    });
    assert.equal(bound.response.status, 200);
    assert.equal(bound.payload.ok, true);
    assert.equal(bound.payload.data.beforeState, 'READY_TO_BIND_REQUIREMENT');
    assert.equal(bound.payload.data.state, 'REQUIREMENT_SATISFIED');
    assert.equal(bound.payload.data.satisfactionPersistence, 'accepted');
    assert.match(String(bound.payload.data.clearanceId), /^finance-clearance:control:/);

    const reconciliation = await runtime.ledgerReconciliationService.reconcile(commercialRecordReference);
    assert.equal(reconciliation.reconciled, true);
    assert.deepEqual(reconciliation.issues, []);

    const reassessed = await post(baseUrl, '/api/v1/control/finance/payment/assess', identifiers);
    assert.equal(reassessed.response.status, 200);
    assert.equal(reassessed.payload.data.state, 'REQUIREMENT_SATISFIED');

    console.log('PASS  Authenticated Finance control plane preserves complete reconciled requirement → payment request → provider state → clearance → satisfaction authority lineage and fails closed on caller-supplied authority.');
  } finally {
    await new Promise((resolve) => server.close(() => resolve())).catch(() => undefined);
  }

  await client.query('rollback');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
