import pg from 'pg';
import { AgentRuntimeRegistry } from '../apps/api/dist/agents/agent-runtime-registry.js';
import { createPostgresProductionHandoffDispatcher } from '../apps/api/dist/agents/production-handoff-postgres.js';
import { FinanceClearancePostgresStore } from '../apps/api/dist/data/finance-clearance-postgres-store.js';
import { OperationsProductionReadinessPostgresStore } from '../apps/api/dist/data/operations-production-readiness-postgres-store.js';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-production-start-handoff-verify' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clearedId = `finance-clearance:production-handoff:${suffix}:cleared`;
const pendingId = `finance-clearance:production-handoff:${suffix}:pending`;
const readinessId = `operations-readiness:production-handoff:${suffix}:ready`;
const blockedReadinessId = `operations-readiness:production-handoff:${suffix}:blocked`;
const commercialRecordReference = `commercial:production-handoff:${suffix}`;

function task() {
  const now = new Date().toISOString();
  return {
    taskId: `task-production-handoff-${suffix}`,
    executionId: `exec-production-handoff-${suffix}`,
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Begin governed production work after Finance and Operations authorization.',
    priority: 'normal',
    context: {},
    knowledgeReferences: [],
    inputs: {},
    expectedOutput: 'Authorised production execution.',
    dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready',
    nextAction: 'dispatch', attempt: 1, maxAttempts: 3,
    correlationId: `corr-production-handoff-${suffix}`, createdAt: now, updatedAt: now,
  };
}

function clearance(clearanceId, state) {
  return {
    clearanceId,
    commercialRecordReference,
    providerPaymentReference: `pay-production-handoff-${suffix}`,
    state,
    reason: state === 'FINANCE_CLEARED' ? 'Live production handoff verification.' : 'Payment remains pending.',
    evidenceReferences: [`payment-provider:axoros-verification:evt-${suffix}`],
    amountMinor: 100,
    currency: 'ZAR',
    verifiedAt: new Date().toISOString(),
  };
}

function readiness(id, state) {
  const ready = state === 'OPERATIONS_READY';
  return {
    readinessId: id,
    commercialRecordReference,
    state,
    contractSigned: ready,
    onboardingComplete: ready,
    assetsAvailable: ready,
    planningComplete: ready,
    evidenceReferences: [`operations-readiness:verification:${suffix}:${state}`],
    approvedBy: 'operations_agent',
    approvedAt: new Date().toISOString(),
  };
}

try {
  await client.connect();
  await client.query('begin');

  const financeStore = new FinanceClearancePostgresStore(client);
  const operationsStore = new OperationsProductionReadinessPostgresStore(client);
  await financeStore.save(clearance(clearedId, 'FINANCE_CLEARED'));
  await financeStore.save(clearance(pendingId, 'FINANCE_PENDING'));
  await operationsStore.save(readiness(readinessId, 'OPERATIONS_READY'));
  await operationsStore.save(readiness(blockedReadinessId, 'OPERATIONS_BLOCKED'));

  const registry = new AgentRuntimeRegistry();
  registry.register({ agentId: 'production_agent', enabled: true, capabilities: [{ capabilityId: 'production_start', description: 'Begin authorised production work.', acceptsHighRisk: false }] });
  const dispatcher = createPostgresProductionHandoffDispatcher({ pool: client, registry });

  const accepted = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: clearedId,
    operationsReadinessId: readinessId,
    commercialRecordReference,
  });
  if (!accepted.accepted || accepted.task.status !== 'in_progress') {
    throw new Error(`expected matching Finance + Operations authority to authorise Production, received ${accepted.reason}`);
  }

  const financeOnly = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: clearedId,
    commercialRecordReference,
  });
  if (financeOnly.accepted || financeOnly.task.status !== 'blocked') {
    throw new Error('Finance-only authority incorrectly authorised Production dispatch.');
  }

  const operationsBlocked = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: clearedId,
    operationsReadinessId: blockedReadinessId,
    commercialRecordReference,
  });
  if (operationsBlocked.accepted || operationsBlocked.task.status !== 'blocked') {
    throw new Error('OPERATIONS_BLOCKED readiness did not block Production dispatch.');
  }

  const missingFinance = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: `finance-clearance:production-handoff:${suffix}:missing`,
    operationsReadinessId: readinessId,
    commercialRecordReference,
  });
  if (missingFinance.accepted || missingFinance.task.status !== 'blocked') {
    throw new Error('missing Finance clearance did not block Production dispatch.');
  }

  const pendingFinance = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: pendingId,
    operationsReadinessId: readinessId,
    commercialRecordReference,
  });
  if (pendingFinance.accepted || pendingFinance.task.status !== 'blocked') {
    throw new Error('FINANCE_PENDING clearance did not block Production dispatch.');
  }

  const mismatched = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: clearedId,
    operationsReadinessId: readinessId,
    commercialRecordReference: `${commercialRecordReference}:mismatch`,
  });
  if (mismatched.accepted || mismatched.task.status !== 'blocked') {
    throw new Error('commercial-record mismatch did not block Production dispatch.');
  }

  await client.query('rollback');
  console.log('PASS  Persisted Production handoff requires matching Finance clearance and Operations readiness; Finance-only, blocked Operations, pending/missing Finance, and mismatched records fail closed.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
