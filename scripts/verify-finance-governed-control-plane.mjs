import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pg from 'pg';
import { createFinanceGovernedControlCommand } from '../apps/api/dist/agents/finance-governed-control-command.js';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { createFinanceControlPlaneRequestHandler } from '../apps/api/dist/finance-control-plane-request-handler.js';
import { DeterministicPaymentIntegration } from '../apps/api/dist/integrations/deterministic-payment-integration.js';
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
const provider = 'deterministic-payment-sandbox';
const providerPaymentReference = `sandbox_paid_${suffix}`;
const providerEventReference = `sandbox-webhook:${suffix}`;
const webhookIdempotencyKey = `payment-webhook:${provider}:${providerEventReference}`;
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
  integrations.register(new DeterministicPaymentIntegration());
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
  assert.equal(ingested.evidence.provider, provider);
  assert.equal(ingested.evidence.providerPaymentReference, providerPaymentReference);
  assert.equal(ingested.evidence.commercialRecordReference, commercialRecordReference);

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
    assert.match(String(bound.payload.data.beforeAuditEventReference), /^workflow-event:/);
    assert.match(String(bound.payload.data.afterAuditEventReference), /^workflow-event:/);

    const persistedClearance = await runtime.clearanceStore.get(bound.payload.data.clearanceId);
    assert.ok(persistedClearance);
    assert.equal(persistedClearance.state, 'FINANCE_CLEARED');
    assert.equal(persistedClearance.commercialRecordReference, commercialRecordReference);
    assert.equal(persistedClearance.providerPaymentReference, providerPaymentReference);

    const persistedSatisfaction = await runtime.satisfactionStore.get(requirementReference);
    assert.ok(persistedSatisfaction);
    assert.equal(persistedSatisfaction.clearanceId, bound.payload.data.clearanceId);
    assert.equal(persistedSatisfaction.commercialRecordReference, commercialRecordReference);
    assert.equal(persistedSatisfaction.gate, 'PRODUCTION_START');

    const reassessed = await post(baseUrl, '/api/v1/control/finance/payment/assess', identifiers);
    assert.equal(reassessed.response.status, 200);
    assert.equal(reassessed.payload.data.state, 'REQUIREMENT_SATISFIED');

    console.log('PASS  Authenticated identifier-only Finance control plane derives READY_TO_BIND_REQUIREMENT from persisted evidence, rejects caller-supplied authority, generates Finance authority internally, and persists matching FINANCE_CLEARED satisfaction before reporting REQUIREMENT_SATISFIED.');
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
