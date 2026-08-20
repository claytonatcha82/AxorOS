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

function createPool() {
  let current: AgentRuntimeExecutionRecord | null = null;
  const idempotency = new Set<string>();
  const runtimeEvents: Array<Record<string, unknown>> = [];
  const workflowEvents: Array<Record<string, unknown>> = [];

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
      runtimeEvents.push({
        event_id: values[0],
        execution_id: values[1],
        task_id: values[2],
        correlation_id: values[3],
        event_type: values[4],
        actor: values[5],
        from_status: values[6],
        to_status: values[7],
        payload: JSON.parse(String(values[8])),
        idempotency_key: values[9],
        occurred_at: values[10],
      });
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('insert into runtime.idempotency_records')) {
      idempotency.add(String(values[0]));
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('from runtime.agent_events')) {
      return {
        rowCount: runtimeEvents.length,
        rows: runtimeEvents.filter((event) => event.execution_id === String(values[0])),
      };
    }

    if (sql.includes('from operational.leads') && sql.includes('where id = $1')) {
      if (String(values[0]) !== 'lead-1') return { rowCount: 0, rows: [] };
      const now = '2026-08-20T17:00:00.000Z';
      return {
        rowCount: 1,
        rows: [{
          id: 'lead-1',
          client_id: null,
          company_name: 'Example Engineering',
          contact_name: null,
          contact_email: null,
          source: 'google_places',
          opportunity_summary: null,
          lead_score: null,
          status: 'new',
          evidence: [],
          created_at: now,
          updated_at: now,
        }],
      };
    }

    if (sql.startsWith('insert into operational.workflow_events')) {
      const createdAt = '2026-08-20T17:05:00.000Z';
      const row = {
        id: `workflow-${workflowEvents.length + 1}`,
        client_id: values[0],
        project_id: values[1],
        event_type: values[2],
        actor_type: values[3],
        actor_id: values[4],
        payload: JSON.parse(String(values[5])),
        created_at: createdAt,
      };
      workflowEvents.push(row);
      return { rowCount: 1, rows: [row] };
    }

    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rowCount: 1, rows: [] };
    throw new Error(`unexpected test SQL: ${sql}`);
  };

  const client = { query, release() {} };
  return {
    pool: {
      query,
      async connect() { return client; },
    } as unknown as Pool,
    workflowEvents,
  };
}

function createTask(
  runtime: ReturnType<typeof createPersistedLeadQualificationRuntimeReview>,
  taskDisposition: LeadQualificationDisposition = disposition,
) {
  return runtime.taskService.createTask({
    taskId: 'lead-qualification-review-task:disposition-1',
    executionId: 'lead-qualification-review:disposition-1',
    correlationId: 'corr-1',
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    dispositionRecordId: 'disposition-1',
    disposition: taskDisposition,
    confidence: 1,
    createdAt: '2026-08-20T17:00:00.000Z',
  });
}

test('approved approve_advance review durably records Sales handoff eligibility without authorising dispatch or outreach', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadQualificationRuntimeReview(harness.pool);
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
  assert.equal(harness.workflowEvents.length, 1);
  assert.equal(harness.workflowEvents[0]?.event_type, 'lead_sales_handoff_eligibility_recorded');
  assert.deepEqual(harness.workflowEvents[0]?.payload, {
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    dispositionRecordId: 'disposition-1',
    reviewExecutionId: 'lead-qualification-review:disposition-1',
    reviewTaskId: 'lead-qualification-review-task:disposition-1',
    eligible: true,
    recommendedAction: 'approve_advance',
    humanApprovalActor: 'human_executive',
    atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
    salesDispatchAuthorised: false,
    outreachAuthorised: false,
  });
});

test('approved non-advance review does not create Sales handoff eligibility', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadQualificationRuntimeReview(harness.pool);
  const task = createTask(runtime, {
    ...disposition,
    recommendedAction: 'collect_more_evidence',
    reasons: ['Additional evidence is required before handoff.'],
  });
  await runtime.registration.register(task);
  await runtime.commands.requestReview(task.executionId);
  const approved = await runtime.commands.resolveReview(task.executionId, 'approved');

  assert.equal(approved.record.task.status, 'ready');
  assert.equal(harness.workflowEvents.length, 0);
});

test('rejected review does not create Sales handoff eligibility', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadQualificationRuntimeReview(harness.pool);
  const task = createTask(runtime);
  await runtime.registration.register(task);
  await runtime.commands.requestReview(task.executionId);
  const rejected = await runtime.commands.resolveReview(task.executionId, 'rejected', 'Do not advance.');

  assert.equal(rejected.record.task.status, 'escalated');
  assert.equal(harness.workflowEvents.length, 0);
});

test('persisted review runtime does not allow resolution before the review gate is requested', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadQualificationRuntimeReview(harness.pool);
  const task = createTask(runtime);
  await runtime.registration.register(task);

  await assert.rejects(
    () => runtime.commands.resolveReview(task.executionId, 'approved'),
    /requires review status/i,
  );
});
