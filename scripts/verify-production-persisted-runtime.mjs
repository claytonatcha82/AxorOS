import pg from 'pg';
import { createPersistedProductionRuntime } from '../apps/api/dist/agents/production-persisted-runtime.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from '../apps/api/dist/agents/production-model-capabilities.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 3,
  application_name: 'axoros-production-persisted-runtime-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:production-runtime:${suffix}`;
const clearedId = `finance-clearance:production-runtime:${suffix}:cleared`;
const pendingId = `finance-clearance:production-runtime:${suffix}:pending`;
const missingId = `finance-clearance:production-runtime:${suffix}:missing`;
const executionIds = [
  `exec-production-runtime:${suffix}:cleared`,
  `exec-production-runtime:${suffix}:pending`,
  `exec-production-runtime:${suffix}:missing`,
];

let modelCalls = 0;
const integrations = new IntegrationRegistry();
integrations.register({
  integrationId: 'model.gemini',
  kind: 'model',
  provider: 'deterministic-live-verifier',
  supportedModes: ['draft'],
  supportedOperations: ['generate_text'],
  async execute(request) {
    modelCalls += 1;
    return {
      integrationId: 'model.gemini',
      operation: request.operation,
      provider: 'deterministic-live-verifier',
      mode: request.mode,
      status: 'drafted',
      output: {
        text: 'governed production verification draft',
        model: 'deterministic-live-verifier',
        finishReason: 'stop',
      },
      evidenceReferences: [`model:production-runtime-verifier:${suffix}`],
      retryable: false,
    };
  },
});

const runtime = createPersistedProductionRuntime({ pool, integrations });

function clearance(clearanceId, state) {
  return {
    clearanceId,
    commercialRecordReference,
    providerPaymentReference: `pay-production-runtime:${suffix}`,
    state,
    reason: state === 'FINANCE_CLEARED'
      ? 'Live persisted Production runtime verification.'
      : 'Payment remains pending.',
    evidenceReferences: [`payment-provider:production-runtime:${suffix}`],
    amountMinor: 100,
    currency: 'ZAR',
    verifiedAt: new Date().toISOString(),
  };
}

function record(executionId, clearanceId) {
  const now = new Date().toISOString();
  return {
    task: {
      taskId: `task:${executionId}`,
      executionId,
      originAgent: 'operations_agent',
      destinationAgent: 'production_agent',
      objective: 'Verify governed persisted Production execution.',
      priority: 'normal',
      context: {
        financeClearanceId: clearanceId,
        commercialRecordReference,
      },
      knowledgeReferences: [],
      inputs: {
        implementationBrief: 'Create a deterministic governed Production verification draft.',
      },
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

async function executeCase(executionId, clearanceId) {
  await runtime.store.saveExecution(record(executionId, clearanceId), 0);
  return runtime.orchestrator.execute({
    executionId,
    capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
  });
}

async function cleanup() {
  await pool.query('delete from runtime.idempotency_records where execution_id = any($1::text[])', [executionIds]);
  await pool.query('delete from runtime.agent_executions where execution_id = any($1::text[])', [executionIds]);
  await pool.query(
    'delete from finance.clearance_decisions where clearance_id = any($1::text[])',
    [[clearedId, pendingId]],
  );
}

try {
  await runtime.financeClearanceStore.save(clearance(clearedId, 'FINANCE_CLEARED'));
  await runtime.financeClearanceStore.save(clearance(pendingId, 'FINANCE_PENDING'));

  const cleared = await executeCase(executionIds[0], clearedId);
  if (cleared.record.task.status !== 'completed' || cleared.record.result?.status !== 'completed') {
    throw new Error(`cleared Production execution did not complete; received ${cleared.record.task.status}.`);
  }
  if (modelCalls !== 1) {
    throw new Error(`cleared Production execution expected one model call; received ${modelCalls}.`);
  }

  const pending = await executeCase(executionIds[1], pendingId);
  if (pending.record.task.status !== 'failed' || pending.record.result?.errorCode !== 'RUNTIME_HANDLER_FAILURE') {
    throw new Error(`FINANCE_PENDING Production execution did not fail closed; received ${pending.record.task.status}.`);
  }
  if (modelCalls !== 1) {
    throw new Error('FINANCE_PENDING Production execution reached the model provider.');
  }

  const missing = await executeCase(executionIds[2], missingId);
  if (missing.record.task.status !== 'failed' || missing.record.result?.errorCode !== 'RUNTIME_HANDLER_FAILURE') {
    throw new Error(`missing Finance Production execution did not fail closed; received ${missing.record.task.status}.`);
  }
  if (modelCalls !== 1) {
    throw new Error('missing Finance Production execution reached the model provider.');
  }

  const persistedCleared = await runtime.store.getExecution(executionIds[0]);
  const persistedPending = await runtime.store.getExecution(executionIds[1]);
  const persistedMissing = await runtime.store.getExecution(executionIds[2]);
  if (persistedCleared?.task.status !== 'completed') throw new Error('cleared completed state was not persisted.');
  if (persistedPending?.task.status !== 'failed') throw new Error('pending failed state was not persisted.');
  if (persistedMissing?.task.status !== 'failed') throw new Error('missing-clearance failed state was not persisted.');

  console.log('PASS  Persisted Production runtime executes only with authoritative FINANCE_CLEARED evidence and fails closed otherwise.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    console.error(`WARN  verifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  await pool.end().catch(() => undefined);
}
