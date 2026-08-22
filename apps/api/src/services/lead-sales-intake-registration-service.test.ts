import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import type { RuntimeMutation } from '../agents/agent-runtime-store.js';
import { createLeadSalesIntakeRegistrationService } from './lead-sales-intake-registration-service.js';

function intakeTask(): AgentRuntimeTask {
  const createdAt = '2026-08-20T17:40:00.000Z';
  return {
    taskId: 'sales-intake-task:eligibility-1',
    executionId: 'sales-intake:eligibility-1',
    originAgent: 'lead_agent',
    destinationAgent: 'sales_agent',
    objective: 'Intake a human-approved qualified opportunity for internal Sales review without contacting the prospect.',
    priority: 'normal',
    context: { leadId: 'lead-1', eligibilityRecordId: 'eligibility-1' },
    knowledgeReferences: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
    inputs: {
      leadId: 'lead-1',
      recommendedAction: 'approve_advance',
      humanApprovalActor: 'human_executive',
      salesIntakeOnly: true,
      salesDispatchAuthorised: false,
      outreachAuthorised: false,
    },
    expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'queued',
    nextAction: 'configure_governed_sales_intake_processing',
    attempt: 1,
    maxAttempts: 1,
    correlationId: 'corr-1',
    createdAt,
    updatedAt: createdAt,
  };
}

class RegistrationStore {
  execution: AgentRuntimeExecutionRecord | null = null;
  mutation: RuntimeMutation | null = null;
  idempotency = new Set<string>();

  async getExecution(executionId: string) {
    return this.execution?.task.executionId === executionId ? this.execution : null;
  }

  async hasIdempotencyKey(key: string) {
    return this.idempotency.has(key);
  }

  async commitRuntimeMutation(mutation: RuntimeMutation) {
    this.mutation = mutation;
    this.execution = mutation.record;
    this.idempotency.add(mutation.idempotencyRecord.idempotencyKey);
  }
}

test('atomically registers queued Sales intake without dispatch or outreach authority', async () => {
  const store = new RegistrationStore();
  const service = createLeadSalesIntakeRegistrationService({ store, createEventId: () => 'event-1' });
  const record = await service.register(intakeTask());

  assert.equal(record.task.status, 'queued');
  assert.equal(record.task.destinationAgent, 'sales_agent');
  assert.equal(record.task.inputs.salesDispatchAuthorised, false);
  assert.equal(record.task.inputs.outreachAuthorised, false);
  assert.equal(store.mutation?.expectedVersion, 0);
  assert.equal(store.mutation?.event.type, 'task_created');
  assert.deepEqual(store.mutation?.event.payload, {
    originAgent: 'lead_agent',
    destinationAgent: 'sales_agent',
    salesIntakeOnly: true,
    salesDispatchAuthorised: false,
    outreachAuthorised: false,
  });
});

test('registration replay reuses the existing Sales intake execution', async () => {
  const store = new RegistrationStore();
  const service = createLeadSalesIntakeRegistrationService({ store, createEventId: () => 'event-1' });
  const first = await service.register(intakeTask());
  const firstMutation = store.mutation;
  const replay = await service.register(intakeTask());

  assert.equal(replay, first);
  assert.equal(store.mutation, firstMutation);
});

test('registration rejects a Sales intake task that authorises outreach', async () => {
  const store = new RegistrationStore();
  const service = createLeadSalesIntakeRegistrationService({ store });
  const task = { ...intakeTask(), inputs: { ...intakeTask().inputs, outreachAuthorised: true } };
  await assert.rejects(() => service.register(task), /must not authorise Sales dispatch or prospect outreach/i);
});

test('registration rejects a ready Sales task so intake cannot silently dispatch', async () => {
  const store = new RegistrationStore();
  const service = createLeadSalesIntakeRegistrationService({ store });
  const task = { ...intakeTask(), status: 'ready' as const };
  await assert.rejects(() => service.register(task), /queued status/i);
});
