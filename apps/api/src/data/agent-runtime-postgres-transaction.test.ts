import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient, QueryResult } from 'pg';
import type { RuntimeMutation } from '../agents/agent-runtime-store.js';
import { RuntimeVersionConflictError } from '../agents/agent-runtime-store.js';
import { createAgentRuntimePostgresStore } from './agent-runtime-postgres-store.js';

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: '', oid: 0, fields: [] } as QueryResult;
}

function mutation(): RuntimeMutation {
  return {
    record: {
      task: {
        taskId: 'task-1',
        executionId: 'exec-1',
        originAgent: 'operations_agent',
        destinationAgent: 'lead_agent',
        objective: 'Generate qualified opportunities',
        priority: 'normal',
        context: {},
        knowledgeReferences: [],
        inputs: {},
        expectedOutput: 'Qualified lead',
        dependencies: [],
        risks: [],
        confidence: 0.9,
        approvalRequired: false,
        status: 'in_progress',
        nextAction: 'execute_destination_capability',
        attempt: 1,
        maxAttempts: 3,
        correlationId: 'corr-1',
        createdAt: '2026-08-12T18:00:00.000Z',
        updatedAt: '2026-08-12T18:01:00.000Z',
      },
      version: 2,
      lastEventId: 'event-1',
      persistedAt: '2026-08-12T18:01:00.000Z',
    },
    expectedVersion: 1,
    event: {
      eventId: 'event-1',
      executionId: 'exec-1',
      taskId: 'task-1',
      correlationId: 'corr-1',
      type: 'status_transitioned',
      actor: 'runtime',
      fromStatus: 'ready',
      toStatus: 'in_progress',
      payload: { capabilityId: 'qualify_lead' },
      idempotencyKey: 'runtime:exec-1:dispatch:qualify_lead:1',
      occurredAt: '2026-08-12T18:01:00.000Z',
    },
    idempotencyRecord: {
      idempotencyKey: 'runtime:exec-1:dispatch:qualify_lead:1',
      executionId: 'exec-1',
      eventId: 'event-1',
      operation: 'status_transitioned',
      firstSeenAt: '2026-08-12T18:01:00.000Z',
      completed: true,
    },
  };
}

function transactionalPool(queryImpl: (sql: string, values?: unknown[]) => Promise<QueryResult>) {
  const calls: string[] = [];
  let released = false;
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push(sql.trim().toLowerCase());
      return queryImpl(sql, values);
    },
    release() {
      released = true;
    },
  } as unknown as PoolClient;
  const pool = {
    connect: async () => client,
  } as unknown as Pool;
  return { pool, calls, released: () => released };
}

test('postgres runtime mutation commits execution, event and idempotency in one transaction', async () => {
  const fixture = transactionalPool(async (sql) => {
    if (/update runtime\.agent_executions/i.test(sql)) return result([{ execution_id: 'exec-1' }], 1);
    return result();
  });
  const store = createAgentRuntimePostgresStore(fixture.pool);

  await store.commitRuntimeMutation!(mutation());

  assert.equal(fixture.calls[0], 'begin');
  assert.match(fixture.calls[1]!, /update runtime\.agent_executions/);
  assert.match(fixture.calls[2]!, /insert into runtime\.agent_events/);
  assert.match(fixture.calls[3]!, /insert into runtime\.idempotency_records/);
  assert.equal(fixture.calls[4], 'commit');
  assert.equal(fixture.calls.includes('rollback'), false);
  assert.equal(fixture.released(), true);
});

test('postgres runtime mutation rolls back when audit event persistence fails', async () => {
  const fixture = transactionalPool(async (sql) => {
    if (/update runtime\.agent_executions/i.test(sql)) return result([{ execution_id: 'exec-1' }], 1);
    if (/insert into runtime\.agent_events/i.test(sql)) throw new Error('audit insert failed');
    return result();
  });
  const store = createAgentRuntimePostgresStore(fixture.pool);

  await assert.rejects(() => store.commitRuntimeMutation!(mutation()), /audit insert failed/);

  assert.equal(fixture.calls.includes('commit'), false);
  assert.equal(fixture.calls.at(-1), 'rollback');
  assert.equal(fixture.released(), true);
});

test('postgres runtime mutation rolls back optimistic version conflicts', async () => {
  const fixture = transactionalPool(async (sql) => {
    if (/update runtime\.agent_executions/i.test(sql)) return result([], 0);
    return result();
  });
  const store = createAgentRuntimePostgresStore(fixture.pool);

  await assert.rejects(() => store.commitRuntimeMutation!(mutation()), RuntimeVersionConflictError);

  assert.equal(fixture.calls.includes('commit'), false);
  assert.equal(fixture.calls.at(-1), 'rollback');
  assert.equal(fixture.released(), true);
});
