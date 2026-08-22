import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import { createLeadSalesIntakeRegistrationService } from './lead-sales-intake-registration-service.js';
import { createLeadSalesIntakeTaskService } from './lead-sales-intake-task-service.js';
import { createPersistedLeadSalesIntakeRuntime } from './lead-sales-persisted-intake-runtime.js';

function createPool() {
  const executions = new Map<string, AgentRuntimeExecutionRecord>();
  const idempotency = new Set<string>();
  const runtimeEvents: Array<Record<string, unknown>> = [];
  const workflowEvents: Array<Record<string, unknown>> = [];

  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (sql.includes('from runtime.agent_executions') && sql.includes('where execution_id = $1')) {
      const record = executions.get(String(values[0]));
      if (!record) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          task: record.task,
          result: record.result ?? null,
          version: record.version,
          last_event_id: record.lastEventId ?? null,
          persisted_at: record.persistedAt,
        }],
      };
    }

    if (sql.includes('from runtime.idempotency_records')) {
      const key = String(values[0]);
      return { rowCount: idempotency.has(key) ? 1 : 0, rows: idempotency.has(key) ? [{ present: 1 }] : [] };
    }

    if (sql.startsWith('insert into runtime.agent_executions')) {
      const task = JSON.parse(String(values[6])) as AgentRuntimeExecutionRecord['task'];
      const record: AgentRuntimeExecutionRecord = {
        task,
        ...(values[7] === null ? {} : { result: JSON.parse(String(values[7])) as NonNullable<AgentRuntimeExecutionRecord['result']> }),
        version: Number(values[5]),
        ...(values[8] === null ? {} : { lastEventId: String(values[8]) }),
        persistedAt: String(values[9]),
      };
      if (executions.has(task.executionId)) return { rowCount: 0, rows: [] };
      executions.set(task.executionId, record);
      return { rowCount: 1, rows: [{ execution_id: task.executionId }] };
    }

    if (sql.startsWith('update runtime.agent_executions')) {
      const task = JSON.parse(String(values[6])) as AgentRuntimeExecutionRecord['task'];
      const current = executions.get(task.executionId);
      if (!current || current.version !== Number(values[10])) return { rowCount: 0, rows: [] };
      executions.set(task.executionId, {
        task,
        ...(values[7] === null ? {} : { result: JSON.parse(String(values[7])) as NonNullable<AgentRuntimeExecutionRecord['result']> }),
        version: Number(values[5]),
        ...(values[8] === null ? {} : { lastEventId: String(values[8]) }),
        persistedAt: String(values[9]),
      });
      return { rowCount: 1, rows: [{ execution_id: task.executionId }] };
    }

    if (sql.includes('insert into runtime.agent_events')) {
      runtimeEvents.push({
        event_id: values[0],
        execution_id: values[1],
        event_type: values[4],
        actor: values[5],
        payload: JSON.parse(String(values[8])),
      });
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('insert into runtime.idempotency_records')) {
      idempotency.add(String(values[0]));
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('from runtime.agent_events')) {
      const matching = runtimeEvents.filter((event) => event.execution_id === String(values[0]));
      return { rowCount: matching.length, rows: matching };
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
          contact_name: 'Jane Doe',
          contact_email: 'jane@example.com',
          source: 'google_places',
          opportunity_summary: 'Potential website redesign opportunity.',
          lead_score: null,
          status: 'new',
          evidence: [],
          created_at: now,
          updated_at: now,
        }],
      };
    }

    if (sql.startsWith('insert into operational.workflow_events')) {
      const createdAt = '2026-08-20T17:10:00.000Z';
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

function createQueuedTask() {
  return createLeadSalesIntakeTaskService().createTask({
    taskId: 'sales-intake-task:eligibility-1',
    executionId: 'sales-intake:eligibility-1',
    correlationId: 'corr-1',
    eligibilityRecordId: 'eligibility-1',
    eligibility: {
      eligible: true,
      leadId: 'lead-1',
      qualificationRecordId: 'qualification-1',
      dispositionRecordId: 'disposition-1',
      reviewExecutionId: 'review-1',
      reviewTaskId: 'review-task-1',
      recommendedAction: 'approve_advance',
      humanApprovalActor: 'human_executive',
      atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
    },
    createdAt: '2026-08-20T17:00:00.000Z',
  });
}

async function registerQueuedTask(runtime: ReturnType<typeof createPersistedLeadSalesIntakeRuntime>) {
  const task = createQueuedTask();
  const commitRuntimeMutation = runtime.store.commitRuntimeMutation;
  if (!commitRuntimeMutation) throw new Error('test requires atomic runtime mutations.');
  const registration = createLeadSalesIntakeRegistrationService({
    store: {
      getExecution: runtime.store.getExecution,
      hasIdempotencyKey: runtime.store.hasIdempotencyKey,
      commitRuntimeMutation,
    },
  });
  await registration.register(task);
  return task;
}

test('persisted Sales intake runtime activates and processes intake without dispatch or outreach authority', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadSalesIntakeRuntime(harness.pool);
  const task = await registerQueuedTask(runtime);

  const activated = await runtime.commands.activateIntake(task.executionId);
  assert.equal(activated.task.status, 'ready');
  assert.equal(activated.task.nextAction, 'execute_internal_sales_intake');

  const processed = await runtime.commands.processIntake(task.executionId);
  assert.equal(processed.record.task.status, 'completed');
  assert.equal(processed.record.result?.status, 'completed');
  assert.equal(processed.record.result?.output.salesDispatchAuthorised, false);
  assert.equal(processed.record.result?.output.outreachAuthorised, false);
  assert.equal(processed.record.result?.output.nextAction, 'define_governed_sales_opportunity_assessment');
});

test('persisted Sales intake runtime records an evidence-backed Sales opportunity assessment after completed intake', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadSalesIntakeRuntime(harness.pool);
  const task = await registerQueuedTask(runtime);
  await runtime.commands.activateIntake(task.executionId);
  await runtime.commands.processIntake(task.executionId);

  const outcome = await runtime.commands.assessOpportunity(task.executionId, {
    decisionMaker: 'Jane Doe',
    industry: 'Engineering',
    country: 'South Africa',
    businessSummary: 'Engineering company requiring a stronger digital presence.',
    websiteAudit: 'Existing website is outdated and weak on conversion.',
    painPoints: ['Outdated website', 'Weak conversion path'],
    recommendedServices: ['Website redesign'],
    priority: 'normal',
    confidence: 0.9,
    previousContact: 'none_recorded',
  });

  assert.equal(outcome.assessment.assessmentStatus, 'context_complete');
  assert.deepEqual(outcome.assessment.missingInformation, []);
  assert.equal(outcome.assessment.outreachAuthorised, false);
  assert.equal(outcome.assessment.pricingAuthorised, false);
  assert.equal(outcome.assessment.commercialCommitmentAuthorised, false);
  assert.equal(harness.workflowEvents.length, 1);
  assert.equal(harness.workflowEvents[0]?.event_type, 'sales_opportunity_assessment_recorded');
  const payload = harness.workflowEvents[0]?.payload as Record<string, unknown>;
  assert.equal(payload.assessmentStatus, 'context_complete');
  assert.equal(payload.outreachAuthorised, false);
  assert.equal(payload.pricingAuthorised, false);
  assert.equal(payload.commercialCommitmentAuthorised, false);
});

test('persisted Sales intake runtime persists incomplete Sales context without inventing missing information', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadSalesIntakeRuntime(harness.pool);
  const task = await registerQueuedTask(runtime);
  await runtime.commands.activateIntake(task.executionId);
  await runtime.commands.processIntake(task.executionId);

  const outcome = await runtime.commands.assessOpportunity(task.executionId);
  assert.equal(outcome.assessment.assessmentStatus, 'context_incomplete');
  assert.ok(outcome.assessment.missingInformation.includes('industry'));
  assert.ok(outcome.assessment.missingInformation.includes('website_audit'));
  assert.equal(harness.workflowEvents.length, 1);
});

test('persisted Sales intake runtime refuses assessment before internal intake completes', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadSalesIntakeRuntime(harness.pool);
  const task = await registerQueuedTask(runtime);

  await assert.rejects(
    () => runtime.commands.assessOpportunity(task.executionId),
    /requires a completed internal Sales intake/i,
  );
  assert.equal(harness.workflowEvents.length, 0);
});

test('persisted Sales intake runtime refuses processing before explicit activation', async () => {
  const harness = createPool();
  const runtime = createPersistedLeadSalesIntakeRuntime(harness.pool);
  const task = await registerQueuedTask(runtime);

  await assert.rejects(
    () => runtime.commands.processIntake(task.executionId),
    /requires ready status; received queued/i,
  );
});
