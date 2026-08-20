import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from '../agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../agents/agent-runtime-orchestrator.js';
import type { RuntimeIdempotencyRecord } from '../agents/agent-runtime-idempotency.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from '../agents/agent-runtime-state.js';
import type { AgentRuntimeStore } from '../agents/agent-runtime-store.js';
import { RuntimeVersionConflictError } from '../agents/agent-runtime-store.js';
import type { LeadQualificationDisposition } from './lead-qualification-disposition-service.js';
import { createLeadQualificationRuntimeReviewService } from './lead-qualification-runtime-review-service.js';

const disposition: LeadQualificationDisposition = {
  disposition: 'hold',
  recommendedAction: 'approve_advance',
  humanApprovalRequired: true,
  reasons: ['Atlas-backed preliminary qualification suggests good fit, but human approval is required before advancing the lead.'],
  atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
};

function createTask() {
  return createLeadQualificationRuntimeReviewService().createTask({
    taskId: 'lead-review-task-1',
    executionId: 'lead-review-exec-1',
    correlationId: 'corr-1',
    leadId: 'lead-1',
    qualificationRecordId: 'qualification-1',
    dispositionRecordId: 'disposition-1',
    disposition,
    confidence: 0.8,
    createdAt: '2026-08-20T15:00:00.000Z',
  });
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(record: AgentRuntimeExecutionRecord) {
    this.execution = record;
  }

  async getExecution(executionId: string): Promise<AgentRuntimeExecutionRecord | null> {
    return this.execution.task.executionId === executionId ? this.execution : null;
  }

  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number): Promise<void> {
    if (this.execution.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId);
    this.execution = record;
  }

  async appendEvent(event: AgentRuntimeEvent): Promise<void> {
    this.events.push(event);
  }

  async listEvents(executionId: string): Promise<readonly AgentRuntimeEvent[]> {
    return this.events.filter((event) => event.executionId === executionId);
  }

  async hasIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    return this.idempotency.has(idempotencyKey);
  }

  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord): Promise<void> {
    this.idempotency.set(record.idempotencyKey, record);
  }
}

test('creates a conservative Lead Agent task governed by human executive approval', () => {
  const task = createTask();

  assert.equal(task.originAgent, 'lead_agent');
  assert.equal(task.destinationAgent, 'lead_agent');
  assert.equal(task.status, 'ready');
  assert.equal(task.approvalRequired, true);
  assert.equal(task.approvalOwner, 'human_executive');
  assert.equal(task.nextAction, 'obtain_required_approval');
  assert.equal(task.maxAttempts, 1);
  assert.equal(task.inputs.leadId, 'lead-1');
  assert.equal(task.inputs.qualificationRecordId, 'qualification-1');
  assert.equal(task.inputs.dispositionRecordId, 'disposition-1');
  assert.equal(task.inputs.recommendedAction, 'approve_advance');
  assert.deepEqual(task.knowledgeReferences, disposition.atlasSourcePaths);
});

test('runtime moves the review task to review without invoking a Lead Agent capability', async () => {
  const task = createTask();
  const store = new MemoryRuntimeStore({ task, version: 1, persistedAt: task.createdAt });
  const handlers = new AgentRuntimeHandlerRegistry();
  let handlerCalled = false;
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualification_review_placeholder',
    async execute(runtimeTask) {
      handlerCalled = true;
      return {
        executionId: runtimeTask.executionId,
        taskId: runtimeTask.taskId,
        agentId: 'lead_agent',
        status: 'completed',
        output: {},
        evidenceReferences: [],
        knowledgeReferences: runtimeTask.knowledgeReferences,
        confidence: 1,
      };
    },
  });

  let eventId = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => '2026-08-20T15:01:00.000Z',
    createEventId: () => `event-${++eventId}`,
  });

  const outcome = await orchestrator.execute({
    executionId: task.executionId,
    capabilityId: 'qualification_review_placeholder',
  });

  assert.equal(handlerCalled, false);
  assert.equal(outcome.record.task.status, 'review');
  assert.equal(outcome.record.task.approvalRequired, true);
  assert.equal(outcome.record.task.approvalOwner, 'human_executive');
  assert.equal(store.events[0]?.type, 'approval_requested');
});

test('rejects a disposition that removes the conservative hold', () => {
  const invalid = { ...disposition, disposition: 'advance' } as unknown as LeadQualificationDisposition;
  assert.throws(
    () => createLeadQualificationRuntimeReviewService().createTask({
      taskId: 'task', executionId: 'exec', correlationId: 'corr', leadId: 'lead', qualificationRecordId: 'qualification', dispositionRecordId: 'disposition', disposition: invalid, confidence: 0.8, createdAt: '2026-08-20T15:00:00.000Z',
    }),
    /conservative hold disposition/i,
  );
});

test('rejects a disposition without Atlas provenance', () => {
  assert.throws(
    () => createLeadQualificationRuntimeReviewService().createTask({
      taskId: 'task', executionId: 'exec', correlationId: 'corr', leadId: 'lead', qualificationRecordId: 'qualification', dispositionRecordId: 'disposition', disposition: { ...disposition, atlasSourcePaths: [] }, confidence: 0.8, createdAt: '2026-08-20T15:00:00.000Z',
    }),
    /authoritative Atlas source paths/i,
  );
});

test('uses runtime contract validation for invalid confidence', () => {
  assert.throws(
    () => createLeadQualificationRuntimeReviewService().createTask({
      taskId: 'task', executionId: 'exec', correlationId: 'corr', leadId: 'lead', qualificationRecordId: 'qualification', dispositionRecordId: 'disposition', disposition, confidence: 1.1, createdAt: '2026-08-20T15:00:00.000Z',
    }),
    /confidence must be between 0 and 1/i,
  );
});
