import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import type { LeadQualificationDisposition } from './lead-qualification-disposition-service.js';
import { createPersistedLeadQualificationRuntimeReview } from './lead-qualification-persisted-runtime-review.js';

const disposition: LeadQualificationDisposition = {
  disposition: 'hold',
  recommendedAction: 'approve_advance',
  humanApprovalRequired: true,
  reasons: ['Atlas-backed preliminary qualification suggests good fit, but human approval is required before advancing the lead.'],
  atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
};

function createPool(): Pool {
  let current: AgentRuntimeExecutionRecord | null = null;
  const idempotency = new Set<string>();
  const events: Array<{ type: string; actor: string }> = [];

  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (sql.includes('from runtime.agent_executions') && sql.includes('where execution_id = $1')) {
      if (!current || current.task.executionId !== String(values[0])) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          task: current.task,
          result: current.result ?? null,
          version: current.version,
          last_event_id: current.lastEventId ?? null,
          persisted_at: current.persistedAt,
        }],
      };
    }

    if (sql.includes('from runtime.idempotency_records')) {
      const key = String(values[0]);
      return { rowCount: idempotency.has(key) ? 1 : 0, rows: idempotency.has(key) ? [{ present: 1 }] : [] };
    }

    if (sql.startsWith('insert into runtime.agent_executions')) {
      current = {
        task: JSON.parse(String(values[6])) as AgentRuntimeExecutionRecord['task'],
        ...(values[7] === null ? {} : { result: JSON.parse(String(values[7])) as NonNullable<AgentRuntimeExecutionRecord['result']> }),
        version: Number(values[5]),
        ...(values[8] === null ? {} : { lastEventId: String(values[8]) }),
        persistedAt: String(values[9]),
      };
      return { rowCount: 1, rows: [{ execution_id: current.task.executionId }] };
    }

    if (sql.startsWith('update runtime.agent_executions')) {
      if (!current || current.version !== Number(values[10])) return { rowCount: 0, rows: [] };
      current = {
        task: JSON.parse(String(values[6])) as AgentRuntimeExecutionRecord['task'],
        ...(values[7] === null ? {} : { result: JSON.parse(String(values[7])) as NonNullable<AgentRuntimeExecutionRecord['result']> }),
        version: Number(values[5]),
        ...(values[8] === null ? {} : { lastEventId: String(values[8]) }),
        persistedAt: String(values[9]),
      };
      return { rowCount: 1, rows: [{ execution_id: current.task.executionId }] };
    }

    if (sql.includes('insert into runtime.agent_events')) {
      events.push({ type: String(values[4]), actor: String(values[5]) });
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('insert into runtime.idempotency_records')) {
      idempotency.add(String(values[0]));
      return { rowCount: 1, rows: [] };
    }

    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rowCount: 1, rows: [] };
    if (sql.includes('from runtime.agent_events')) return { rowCount: 0, rows: [] };
    throw new Error(`unexpected test SQL: ${sql}`);
  };

  const client = { query, release() {} };
  return {
    query,
    async connect() { return client; },
  } as unknown as Pool;
}

function createTask(runtime: ReturnType<typeof createPersistedLeadQualificationRuntimeReview>) {
  return runtime.taskService.createTask({
    taskId: 'lead-qualification-review-task:disposition-1',
    executionId: 'lead-qualification-review:disposition-1',
    correlationId: 'corr-1',
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    dispositionRecordId: 'disposition-1',
    disposition,
    confidence: 1,
    createdAt: '2026-08-20T17:00:00.000Z',
  });
}

test('persisted review runtime registers, requests, and resolves human executive approval', async () => {
  const runtime = createPersistedLeadQualificationRuntimeReview(createPool());
  const task = createTask(runtime);
  await runtime.registration.register(task);

  const review = await runtime.commands.requestReview(task.executionId);
  assert.equal(review.record.task.status, 'review');
  assert.equal(review.record.task.approvalRequired, true);
  assert.equal(review.record.task.approvalOwner, 'human_executive');
  assert.equal(review.record.task.nextAction, 'obtain_required_approval');

  const approved = await runtime.commands.resolveReview(task.executionId, 'approved', 'Founder approved controlled continuation.');
  assert.equal(approved.record.task.status, 'ready');
  assert.equal(approved.record.task.approvalRequired, false);
  assert.equal(approved.record.task.nextAction, 'execute_destination_capability');
});

test('persisted review runtime does not allow resolution before the review gate is requested', async () => {
  const runtime = createPersistedLeadQualificationRuntimeReview(createPool());
  const task = createTask(runtime);
  await runtime.registration.register(task);

  await assert.rejects(
    () => runtime.commands.resolveReview(task.executionId, 'approved'),
    /requires review status/i,
  );
});
