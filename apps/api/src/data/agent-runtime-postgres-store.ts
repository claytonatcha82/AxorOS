import type { Pool } from 'pg';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from '../agents/agent-runtime-state.js';
import type { RuntimeIdempotencyRecord } from '../agents/agent-runtime-idempotency.js';
import { RuntimeVersionConflictError, type AgentRuntimeStore } from '../agents/agent-runtime-store.js';

function parseJson<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function mapExecution(row: Record<string, unknown>): AgentRuntimeExecutionRecord {
  return {
    task: parseJson(row.task),
    ...(row.result === null ? {} : { result: parseJson(row.result) }),
    version: Number(row.version),
    ...(row.last_event_id === null ? {} : { lastEventId: String(row.last_event_id) }),
    persistedAt: new Date(String(row.persisted_at)).toISOString(),
  };
}

function mapEvent(row: Record<string, unknown>): AgentRuntimeEvent {
  const event: AgentRuntimeEvent = {
    eventId: String(row.event_id),
    executionId: String(row.execution_id),
    taskId: String(row.task_id),
    correlationId: String(row.correlation_id),
    type: String(row.event_type) as AgentRuntimeEvent['type'],
    actor: String(row.actor) as AgentRuntimeEvent['actor'],
    payload: parseJson<Record<string, unknown>>(row.payload),
    idempotencyKey: String(row.idempotency_key),
    occurredAt: new Date(String(row.occurred_at)).toISOString(),
  };

  if (row.from_status !== null && row.from_status !== undefined) {
    event.fromStatus = String(row.from_status) as NonNullable<AgentRuntimeEvent['fromStatus']>;
  }
  if (row.to_status !== null && row.to_status !== undefined) {
    event.toStatus = String(row.to_status) as NonNullable<AgentRuntimeEvent['toStatus']>;
  }

  return event;
}

export function createAgentRuntimePostgresStore(pool: Pool): AgentRuntimeStore {
  return {
    async getExecution(executionId) {
      const result = await pool.query(
        `select task, result, version, last_event_id, persisted_at
         from runtime.agent_executions
         where execution_id = $1`,
        [executionId],
      );
      return result.rows[0] ? mapExecution(result.rows[0] as Record<string, unknown>) : null;
    },

    async saveExecution(record, expectedVersion) {
      if (expectedVersion === 0) {
        const result = await pool.query(
          `insert into runtime.agent_executions
             (execution_id, task_id, correlation_id, destination_agent, status, version, task, result, last_event_id, persisted_at)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
           on conflict (execution_id) do nothing
           returning execution_id`,
          [
            record.task.executionId,
            record.task.taskId,
            record.task.correlationId,
            record.task.destinationAgent,
            record.task.status,
            record.version,
            JSON.stringify(record.task),
            record.result ? JSON.stringify(record.result) : null,
            record.lastEventId ?? null,
            record.persistedAt,
          ],
        );
        if (result.rowCount !== 1) throw new RuntimeVersionConflictError(record.task.executionId);
        return;
      }

      const result = await pool.query(
        `update runtime.agent_executions
         set task_id = $2,
             correlation_id = $3,
             destination_agent = $4,
             status = $5,
             version = $6,
             task = $7::jsonb,
             result = $8::jsonb,
             last_event_id = $9,
             persisted_at = $10,
             updated_at = now()
         where execution_id = $1 and version = $11
         returning execution_id`,
        [
          record.task.executionId,
          record.task.taskId,
          record.task.correlationId,
          record.task.destinationAgent,
          record.task.status,
          record.version,
          JSON.stringify(record.task),
          record.result ? JSON.stringify(record.result) : null,
          record.lastEventId ?? null,
          record.persistedAt,
          expectedVersion,
        ],
      );
      if (result.rowCount !== 1) throw new RuntimeVersionConflictError(record.task.executionId);
    },

    async appendEvent(event) {
      await pool.query(
        `insert into runtime.agent_events
           (event_id, execution_id, task_id, correlation_id, event_type, actor, from_status, to_status, payload, idempotency_key, occurred_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          event.eventId,
          event.executionId,
          event.taskId,
          event.correlationId,
          event.type,
          event.actor,
          event.fromStatus ?? null,
          event.toStatus ?? null,
          JSON.stringify(event.payload),
          event.idempotencyKey,
          event.occurredAt,
        ],
      );
    },

    async listEvents(executionId) {
      const result = await pool.query(
        `select event_id, execution_id, task_id, correlation_id, event_type, actor, from_status, to_status,
                payload, idempotency_key, occurred_at
         from runtime.agent_events
         where execution_id = $1
         order by occurred_at asc, event_id asc`,
        [executionId],
      );
      return result.rows.map((row) => mapEvent(row as Record<string, unknown>));
    },

    async hasIdempotencyKey(idempotencyKey) {
      const result = await pool.query(
        `select 1 from runtime.idempotency_records where idempotency_key = $1 limit 1`,
        [idempotencyKey],
      );
      return (result.rowCount ?? result.rows.length) > 0;
    },

    async saveIdempotencyRecord(record: RuntimeIdempotencyRecord) {
      await pool.query(
        `insert into runtime.idempotency_records
           (idempotency_key, execution_id, event_id, operation, first_seen_at, completed)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (idempotency_key) do nothing`,
        [record.idempotencyKey, record.executionId, record.eventId, record.operation, record.firstSeenAt, record.completed],
      );
    },
  };
}
