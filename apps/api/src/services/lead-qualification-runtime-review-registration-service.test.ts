import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from '../agents/agent-runtime-contract.js';
import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import type { RuntimeMutation } from '../agents/agent-runtime-store.js';
import { createLeadQualificationRuntimeReviewRegistrationService } from './lead-qualification-runtime-review-registration-service.js';

function reviewTask(): AgentRuntimeTask {
  const createdAt = '2026-08-20T17:00:00.000Z';
  return {
    taskId: 'lead-qualification-review-task:disposition-1',
    executionId: 'lead-qualification-review:disposition-1',
    originAgent: 'lead_agent',
    destinationAgent: 'lead_agent',
    objective: 'Obtain human review of the Atlas-backed lead qualification disposition.',
    priority: 'normal',
    context: { leadId: 'lead-1', qualificationRecordId: 'qualification-1', dispositionRecordId: 'disposition-1' },
    knowledgeReferences: ['Volume 1 - Agency/Lead Qualification.md'],
    inputs: { disposition: 'hold', recommendedAction: 'collect_more_evidence' },
    expectedOutput: 'A governed human approval decision for the recorded lead qualification disposition.',
    dependencies: [],
    risks: ['More evidence required.'],
    confidence: 1,
    approvalRequired: true,
    approvalOwner: 'human_executive',
    status: 'ready',
    nextAction: 'obtain_required_approval',
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

test('atomically registers governed review execution with task-created audit event', async () => {
  const store = new RegistrationStore();
  const service = createLeadQualificationRuntimeReviewRegistrationService({ store, createEventId: () => 'event-1' });
  const record = await service.register(reviewTask());

  assert.equal(record.version, 1);
  assert.equal(record.lastEventId, 'event-1');
  assert.equal(record.task.approvalOwner, 'human_executive');
  assert.equal(store.mutation?.expectedVersion, 0);
  assert.equal(store.mutation?.event.type, 'task_created');
  assert.equal(store.mutation?.event.actor, 'runtime');
  assert.equal(store.mutation?.idempotencyRecord.completed, true);
  assert.equal(store.mutation?.idempotencyRecord.operation, 'task_created');
});

test('reuses the existing runtime execution when registration is replayed', async () => {
  const store = new RegistrationStore();
  const service = createLeadQualificationRuntimeReviewRegistrationService({ store, createEventId: () => 'event-1' });
  const first = await service.register(reviewTask());
  const firstMutation = store.mutation;
  const replay = await service.register(reviewTask());

  assert.equal(replay, first);
  assert.equal(store.mutation, firstMutation);
});

test('rejects runtime review registration that removes human executive approval', async () => {
  const store = new RegistrationStore();
  const service = createLeadQualificationRuntimeReviewRegistrationService({ store });
  const task = { ...reviewTask(), approvalRequired: false, approvalOwner: undefined } as unknown as AgentRuntimeTask;
  await assert.rejects(() => service.register(task), /approval/i);
});
