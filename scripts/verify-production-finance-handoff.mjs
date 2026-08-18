import pg from 'pg';
import { AgentRuntimeRegistry } from '../apps/api/dist/agents/agent-runtime-registry.js';
import { createPostgresProductionHandoffDispatcher } from '../apps/api/dist/agents/production-handoff-postgres.js';
import { FinanceClearancePostgresStore } from '../apps/api/dist/data/finance-clearance-postgres-store.js';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-production-finance-handoff-verify' });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clearedId = `finance-clearance:production-handoff:${suffix}:cleared`;
const pendingId = `finance-clearance:production-handoff:${suffix}:pending`;
const commercialRecordReference = `commercial:production-handoff:${suffix}`;

function task() {
  const now = new Date().toISOString();
  return {
    taskId: `task-production-handoff-${suffix}`,
    executionId: `exec-production-handoff-${suffix}`,
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Begin governed production work after verified Finance clearance.',
    priority: 'normal',
    context: {},
    knowledgeReferences: [],
    inputs: {},
    expectedOutput: 'Authorised production execution.',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'dispatch',
    attempt: 1,
    maxAttempts: 3,
    correlationId: `corr-production-handoff-${suffix}`,
    createdAt: now,
    updatedAt: now,
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

try {
  await client.connect();
  await client.query('begin');

  const financeStore = new FinanceClearancePostgresStore(client);
  await financeStore.save(clearance(clearedId, 'FINANCE_CLEARED'));
  await financeStore.save(clearance(pendingId, 'FINANCE_PENDING'));

  const registry = new AgentRuntimeRegistry();
  registry.register({
    agentId: 'production_agent',
    enabled: true,
    capabilities: [{
      capabilityId: 'production_start',
      description: 'Begin authorised production work.',
      acceptsHighRisk: false,
    }],
  });

  const dispatcher = createPostgresProductionHandoffDispatcher({ pool: client, registry });

  const accepted = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: clearedId,
    commercialRecordReference,
  });
  if (!accepted.accepted || accepted.task.status !== 'in_progress') {
    throw new Error(`expected cleared Finance record to authorise Production, received ${accepted.reason}`);
  }

  const missing = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: `finance-clearance:production-handoff:${suffix}:missing`,
    commercialRecordReference,
  });
  if (missing.accepted || missing.task.status !== 'blocked') {
    throw new Error('missing Finance clearance did not block Production dispatch.');
  }

  const pending = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: pendingId,
    commercialRecordReference,
  });
  if (pending.accepted || pending.task.status !== 'blocked') {
    throw new Error('FINANCE_PENDING clearance did not block Production dispatch.');
  }

  const mismatched = await dispatcher.dispatch(task(), 'production_start', {
    clearanceId: clearedId,
    commercialRecordReference: `${commercialRecordReference}:mismatch`,
  });
  if (mismatched.accepted || mismatched.task.status !== 'blocked') {
    throw new Error('commercial-record mismatch did not block Production dispatch.');
  }

  await client.query('rollback');
  console.log('PASS  Persisted Finance clearance authorises Production only for the matching governed commercial record.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
