import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pg from 'pg';
import { createControlPlaneRequestHandler } from '../apps/api/dist/control-plane-request-handler.js';
import { createOperationsProductionPrerequisiteRecorder } from '../apps/api/dist/agents/operations-production-prerequisite-recorder.js';
import { createOperationsProductionReadinessPostgresService } from '../apps/api/dist/agents/operations-production-readiness-postgres.js';
import { createPersistedProductionRuntime } from '../apps/api/dist/agents/production-persisted-runtime.js';
import { satisfyCommercialPaymentRequirement } from '../apps/api/dist/agents/finance-commercial-payment-requirement.js';
import { FinancePaymentCurrentStatePostgresStore } from '../apps/api/dist/data/finance-payment-current-state-postgres-store.js';
import { CommercialPaymentRequirementPostgresStore } from '../apps/api/dist/data/commercial-payment-requirement-postgres-store.js';
import { CommercialPaymentSatisfactionPostgresStore } from '../apps/api/dist/data/commercial-payment-satisfaction-postgres-store.js';
import { createOperationalRepository } from '../apps/api/dist/data/operational-repository.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 3, application_name: 'axoros-operations-production-control-transition-verify' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'operations-production-control-verifier';
const controlPlaneToken = `operations-production-control-token-${suffix}`;
const controlCenterUrl = 'http://127.0.0.1:5173';
let modelCalls = 0;

const integrations = new IntegrationRegistry();
integrations.register({
  integrationId: 'model.gemini',
  kind: 'model',
  provider: 'deterministic-control-transition-verifier',
  supportedModes: ['draft'],
  supportedOperations: ['generate_text'],
  async execute(request) {
    modelCalls += 1;
    return {
      integrationId: 'model.gemini',
      operation: request.operation,
      provider: 'deterministic-control-transition-verifier',
      mode: request.mode,
      status: 'drafted',
      output: { text: 'governed control-plane production draft', model: 'deterministic-verifier', finishReason: 'stop' },
      evidenceReferences: [`model:operations-production-control:${suffix}:${modelCalls}`],
      retryable: false,
    };
  },
});

const productionRuntime = createPersistedProductionRuntime({ pool, integrations });
const operationsService = createOperationsProductionReadinessPostgresService({ pool });
const operationalRepository = createOperationalRepository(pool);
const prerequisiteRecorder = createOperationsProductionPrerequisiteRecorder(operationalRepository);
const paymentStateStore = new FinancePaymentCurrentStatePostgresStore(pool);
const requirementStore = new CommercialPaymentRequirementPostgresStore(pool);
const satisfactionStore = new CommercialPaymentSatisfactionPostgresStore(pool);

const commercialRecordReference = `commercial:operations-production-control:${suffix}`;
const mismatchedCommercialRecord = `commercial:operations-production-control:${suffix}:other`;
const paymentReference = `payment:operations-production-control:${suffix}`;
const clearanceId = `finance-clearance:operations-production-control:${suffix}`;
const requirementReference = `deposit:${commercialRecordReference}`;
const readinessId = `operations-readiness:control:${suffix}`;
const mismatchedReadinessId = `operations-readiness:control:${suffix}:mismatch`;
const authorizedExecutionId = `exec:operations-production-control:${suffix}:authorized`;
const financeOnlyExecutionId = `exec:operations-production-control:${suffix}:finance-only`;
const mismatchExecutionId = `exec:operations-production-control:${suffix}:mismatch`;
const paidAt = new Date().toISOString();
const paidEventReference = `event-paid:${suffix}`;
const paidEvidenceReference = `payment-provider:${provider}:${paidEventReference}`;
const executionIds = [authorizedExecutionId, financeOnlyExecutionId, mismatchExecutionId];
const readinessIds = [readinessId, mismatchedReadinessId];
const workflowEventIds = [];

function runtimeRecord(executionId, operationsReadinessId, commercialReference = commercialRecordReference) {
  const now = new Date().toISOString();
  const context = { financeClearanceId: clearanceId, commercialRecordReference: commercialReference };
  if (operationsReadinessId) context.operationsReadinessId = operationsReadinessId;
  return {
    task: {
      taskId: `task:${executionId}`,
      executionId,
      originAgent: 'operations_agent',
      destinationAgent: 'production_agent',
      objective: 'Verify governed Operations to Production control-plane transition.',
      priority: 'normal',
      context,
      knowledgeReferences: [],
      inputs: { implementationBrief: 'Produce a deterministic governed verification draft.' },
      expectedOutput: 'Technical implementation draft',
      dependencies: [],
      risks: [],
      confidence: 1,
      approvalRequired: false,
      status: 'ready',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 1,
      correlationId: `corr:${executionId}`,
      createdAt: now,
      updatedAt: now,
    },
    version: 1,
    persistedAt: now,
  };
}

const fallback = (_request, response) => {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false }));
};
const handler = createControlPlaneRequestHandler({
  config: { controlCenterUrl, controlPlaneToken },
  productionCommand: productionRuntime.commands,
  operationsProductionPrerequisiteCommand: prerequisiteRecorder,
  operationsProductionReadinessCommand: operationsService,
  fallback,
});
const server = createServer(handler);

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${controlPlaneToken}`,
      'content-type': 'application/json',
      origin: controlCenterUrl,
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function recordPrerequisites(baseUrl, commercialReference) {
  for (const prerequisite of ['contractSigned', 'onboardingComplete', 'assetsAvailable', 'planningComplete']) {
    const recorded = await post(baseUrl, '/api/v1/control/operations/production-prerequisite/record', {
      commercialRecordReference: commercialReference,
      prerequisite,
      evidenceReference: `verifier:${prerequisite}:${commercialReference}`,
      observedAt: new Date().toISOString(),
    });
    assert.equal(recorded.response.status, 200);
    assert.equal(recorded.payload.ok, true);
    assert.equal(recorded.payload.data.commercialRecordReference, commercialReference);
    workflowEventIds.push(String(recorded.payload.data.eventId));
  }
}

async function cleanup() {
  await pool.query('delete from runtime.idempotency_records where execution_id = any($1::text[])', [executionIds]);
  await pool.query('delete from runtime.agent_executions where execution_id = any($1::text[])', [executionIds]);
  await pool.query('delete from finance.commercial_payment_satisfactions where requirement_reference = $1', [requirementReference]);
  await pool.query('delete from operations.production_readiness_decisions where readiness_id = any($1::text[])', [readinessIds]);
  if (workflowEventIds.length > 0) {
    await pool.query('delete from operational.workflow_events where id::text = any($1::text[])', [workflowEventIds]);
  }
  await pool.query('delete from finance.clearance_decisions where clearance_id = $1', [clearanceId]);
  await pool.query('delete from finance.payment_current_state where provider = $1 and provider_payment_reference = $2', [provider, paymentReference]);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1', [commercialRecordReference]);
}

try {
  await requirementStore.save({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 10000,
    currency: 'ZAR',
    status: 'ACTIVE',
  });
  await productionRuntime.financeClearanceStore.save({
    clearanceId,
    commercialRecordReference,
    providerPaymentReference: paymentReference,
    state: 'FINANCE_CLEARED',
    reason: 'Trusted deterministic control-transition verifier evidence matched.',
    evidenceReferences: [paidEvidenceReference],
    amountMinor: 10000,
    currency: 'ZAR',
    verifiedAt: paidAt,
  });
  await paymentStateStore.apply({
    idempotencyKey: `payment-webhook:${provider}:${paidEventReference}`,
    provider,
    providerEventReference: paidEventReference,
    providerPaymentReference: paymentReference,
    eventType: 'payment_paid',
    commercialRecordReference,
    amountMinor: 10000,
    currency: 'ZAR',
    occurredAt: paidAt,
    evidenceReference: paidEvidenceReference,
  });
  await satisfyCommercialPaymentRequirement({
    requirementStore,
    satisfactionStore,
    clearanceStore: productionRuntime.financeClearanceStore,
  }, { commercialRecordReference, gate: 'PRODUCTION_START', clearanceId });

  await productionRuntime.store.saveExecution(runtimeRecord(financeOnlyExecutionId), 0);
  await productionRuntime.store.saveExecution(runtimeRecord(authorizedExecutionId, readinessId), 0);
  await productionRuntime.store.saveExecution(runtimeRecord(mismatchExecutionId, mismatchedReadinessId), 0);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const callsBeforeFinanceOnly = modelCalls;
  const financeOnly = await post(baseUrl, '/api/v1/control/production/execute', { executionId: financeOnlyExecutionId });
  assert.equal(financeOnly.response.status, 200);
  assert.equal(financeOnly.payload.data.status, 'failed');
  assert.equal(modelCalls, callsBeforeFinanceOnly);

  await recordPrerequisites(baseUrl, commercialRecordReference);
  const readiness = await post(baseUrl, '/api/v1/control/operations/production-readiness/assess', {
    readinessId,
    commercialRecordReference,
    assessedAt: new Date().toISOString(),
  });
  assert.equal(readiness.response.status, 200);
  assert.equal(readiness.payload.data.state, 'OPERATIONS_READY');

  await recordPrerequisites(baseUrl, mismatchedCommercialRecord);
  const mismatchReadiness = await post(baseUrl, '/api/v1/control/operations/production-readiness/assess', {
    readinessId: mismatchedReadinessId,
    commercialRecordReference: mismatchedCommercialRecord,
    assessedAt: new Date().toISOString(),
  });
  assert.equal(mismatchReadiness.response.status, 200);
  assert.equal(mismatchReadiness.payload.data.state, 'OPERATIONS_READY');

  const callsBeforeMismatch = modelCalls;
  const mismatch = await post(baseUrl, '/api/v1/control/production/execute', { executionId: mismatchExecutionId });
  assert.equal(mismatch.response.status, 200);
  assert.equal(mismatch.payload.data.status, 'failed');
  assert.equal(modelCalls, callsBeforeMismatch);

  const callsBeforeAuthorized = modelCalls;
  const authorized = await post(baseUrl, '/api/v1/control/production/execute', { executionId: authorizedExecutionId });
  assert.equal(authorized.response.status, 200);
  assert.equal(authorized.payload.data.status, 'completed');
  assert.equal(authorized.payload.data.resultStatus, 'completed');
  assert.equal(modelCalls, callsBeforeAuthorized + 1);

  const persistedReadiness = await operationsService.readinessStore.get(readinessId);
  assert.ok(persistedReadiness);
  assert.equal(persistedReadiness.state, 'OPERATIONS_READY');
  assert.equal(persistedReadiness.commercialRecordReference, commercialRecordReference);
  assert.equal(persistedReadiness.evidenceReferences.length, 4);
  assert.ok(persistedReadiness.evidenceReferences.every((reference) => reference.startsWith('workflow-event:')));

  console.log('PASS  Authenticated Operations prerequisite recording creates persisted evidence; identifier-only readiness then combines with matching Finance satisfaction before authenticated Production execution can reach the model provider.');
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
