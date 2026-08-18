import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeRegistry } from './agent-runtime-registry.js';
import { createPostgresProductionHandoffDispatcher } from './production-handoff-postgres.js';

function mockPoolQuery(
  implementation: (sql: string, values?: readonly unknown[]) => { rowCount: number; rows: unknown[] },
): Pick<Pool, 'query'> {
  return {
    query: (async (sql: string, values?: readonly unknown[]) => implementation(sql, values)) as Pool['query'],
  };
}

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId: 'production-task-1',
    executionId: 'production-exec-1',
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Start governed client production work',
    priority: 'normal',
    context: {},
    knowledgeReferences: [],
    inputs: {},
    expectedOutput: 'Production work started under governed scope',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'dispatch',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'production-corr-1',
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
    ...overrides,
  };
}

function registry(): AgentRuntimeRegistry {
  const runtimeRegistry = new AgentRuntimeRegistry();
  runtimeRegistry.register({
    agentId: 'production_agent',
    enabled: true,
    capabilities: [{
      capabilityId: 'production_start',
      description: 'Start governed production work.',
      acceptsHighRisk: true,
    }],
  });
  return runtimeRegistry;
}

function persistedClearanceRow(state: 'FINANCE_CLEARED' | 'FINANCE_PENDING' = 'FINANCE_CLEARED') {
  return {
    clearance_id: 'finance-clearance:test:1',
    commercial_record_reference: 'commercial:test:1',
    provider_payment_reference: 'pay_test_1',
    state,
    reason: state === 'FINANCE_CLEARED'
      ? 'Provider payment evidence matches the governed commercial record.'
      : 'Payment awaiting verification.',
    evidence_references: ['payment-provider:sandbox:evt_1'],
    amount_minor: '125000',
    currency: 'ZAR',
    verified_at: new Date('2026-08-18T08:40:00.123Z'),
  };
}

const authorisation = {
  clearanceId: 'finance-clearance:test:1',
  commercialRecordReference: 'commercial:test:1',
};

test('PostgreSQL-backed production handoff dispatches only after persisted Finance clearance', async () => {
  const dispatcher = createPostgresProductionHandoffDispatcher({
    pool: mockPoolQuery(() => ({ rowCount: 1, rows: [persistedClearanceRow()] })),
    registry: registry(),
  });

  const result = await dispatcher.dispatch(task(), 'production_start', authorisation);

  assert.equal(result.accepted, true);
  assert.equal(result.task.status, 'in_progress');
  assert.equal(result.task.nextAction, 'execute_destination_capability');
});

test('PostgreSQL-backed production handoff blocks when Finance clearance is missing', async () => {
  const dispatcher = createPostgresProductionHandoffDispatcher({
    pool: mockPoolQuery(() => ({ rowCount: 0, rows: [] })),
    registry: registry(),
  });

  const result = await dispatcher.dispatch(task(), 'production_start', authorisation);

  assert.equal(result.accepted, false);
  assert.equal(result.task.status, 'blocked');
  assert.equal(result.task.nextAction, 'resolve_finance_clearance');
  assert.match(result.reason, /no persisted Finance clearance found/);
});

test('PostgreSQL-backed production handoff blocks persisted FINANCE_PENDING decisions', async () => {
  const dispatcher = createPostgresProductionHandoffDispatcher({
    pool: mockPoolQuery(() => ({ rowCount: 1, rows: [persistedClearanceRow('FINANCE_PENDING')] })),
    registry: registry(),
  });

  const result = await dispatcher.dispatch(task(), 'production_start', authorisation);

  assert.equal(result.accepted, false);
  assert.equal(result.task.status, 'blocked');
  assert.equal(result.task.nextAction, 'resolve_finance_clearance');
  assert.match(result.reason, /Payment awaiting verification/);
});

test('PostgreSQL-backed production handoff blocks commercial record mismatch', async () => {
  const dispatcher = createPostgresProductionHandoffDispatcher({
    pool: mockPoolQuery(() => ({ rowCount: 1, rows: [persistedClearanceRow()] })),
    registry: registry(),
  });

  const result = await dispatcher.dispatch(task(), 'production_start', {
    ...authorisation,
    commercialRecordReference: 'commercial:other',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.task.status, 'blocked');
  assert.equal(result.task.nextAction, 'resolve_finance_clearance');
  assert.match(result.reason, /does not match the governed commercial record/);
});
