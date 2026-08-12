import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, QueryResult } from 'pg';
import { RuntimeVersionConflictError } from '../agents/agent-runtime-store.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from '../agents/agent-runtime-state.js';
import { createAgentRuntimePostgresStore } from './agent-runtime-postgres-store.js';

function sampleRecord(version = 1): AgentRuntimeExecutionRecord {
  return {
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
      status: 'ready',
      nextAction: 'Dispatch',
      attempt: 1,
      maxAttempts: 3,
      correlationId: 'corr-1',
      createdAt: '2026-08-12T18:00:00.000Z',
      updatedAt: '2026-08-12T18:00:00.000Z',
    },
    version,
    persistedAt: '2026-08-12T18:00:00.000Z',
  };
}

function sampleEvent(): AgentRuntimeEvent {
  return {
    eventId: 'event-1',
    executionId: 'exec-1',
    taskId: 'task-1',
    correlationId: 'corr-1',
    type: 'status_transitioned',
    actor: 'runtime',
    fromStatus: 'ready',
    toStatus: 'in_progress',
    payload: { reason: 'dispatch' },
    idempotencyKey: 'runtime:exec-1:dispatch',
    occurredAt: '2026-08-12T18:01:00.000Z',
  };
}

function result(rows: Record<string, unknown>[], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: '', oid: 0, fields: [] } as QueryResult;
}

test('postgres runtime store inserts a new execution with optimistic create semantics', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push(values === undefined ? { sql } : { sql, values });
      return result([{ execution_id: 'exec-1' }], 1);
    },
  } as unknown as Pool;

  const store = createAgentRuntimePostgresStore(pool);
  await store.saveExecution(sampleRecord(), 0);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /insert into runtime\.agent_executions/);
  assert.match(calls[0]!.sql, /on conflict \(execution_id\) do nothing/);
});

test('postgres runtime store rejects stale execution versions', async () => {
  const pool = {
    query: async () => result([], 0),
  } as unknown as Pool;

  const store = createAgentRuntimePostgresStore(pool);
  await assert.rejects(() => store.saveExecution(sampleRecord(2), 1), RuntimeVersionConflictError);
});

test('postgres runtime store maps persisted execution and events', async () => {
  let call = 0;
  const pool = {
    query: async () => {
      call += 1;
      if (call === 1) {
        return result([{
          task: sampleRecord().task,
          result: null,
          version: 1,
          last_event_id: null,
          persisted_at: '2026-08-12T18:00:00.000Z',
        }]);
      }
      const event = sampleEvent();
      return result([{
        event_id: event.eventId,
        execution_id: event.executionId,
        task_id: event.taskId,
        correlation_id: event.correlationId,
        event_type: event.type,
        actor: event.actor,
        from_status: event.fromStatus,
        to_status: event.toStatus,
        payload: event.payload,
        idempotency_key: event.idempotencyKey,
        occurred_at: event.occurredAt,
      }]);
    },
  } as unknown as Pool;

  const store = createAgentRuntimePostgresStore(pool);
  const execution = await store.getExecution('exec-1');
  const events = await store.listEvents('exec-1');

  assert.equal(execution?.task.executionId, 'exec-1');
  assert.equal(execution?.version, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.toStatus, 'in_progress');
  assert.deepEqual(events[0]?.payload, { reason: 'dispatch' });
});

test('postgres runtime store checks idempotency records deterministically', async () => {
  const pool = {
    query: async () => result([{ '?column?': 1 }], 1),
  } as unknown as Pool;

  const store = createAgentRuntimePostgresStore(pool);
  assert.equal(await store.hasIdempotencyKey('runtime:exec-1:dispatch'), true);
});
