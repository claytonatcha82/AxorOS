import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';

function sampleRecord(options: {
  status?: 'ready' | 'failed';
  attempt?: number;
  maxAttempts?: number;
  approvalRequired?: boolean;
  approvalOwner?: 'executive_agent' | 'human_executive';
  priority?: 'normal' | 'critical';
} = {}): AgentRuntimeExecutionRecord {
  const task = {
    taskId: 'task-approval-retry',
    executionId: 'exec-approval-retry',
    originAgent: 'operations_agent' as const,
    destinationAgent: 'lead_agent' as const,
    objective: 'Generate qualified opportunities',
    priority: options.priority ?? 'normal',
    context: {},
    knowledgeReferences: [],
    inputs: {},
    expectedOutput: 'Qualified lead',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: options.approvalRequired ?? false,
    status: options.status ?? 'ready',
    nextAction: 'execute_destination_capability',
    attempt: options.attempt ?? 1,
    maxAttempts: options.maxAttempts ?? 3,
    correlationId: 'corr-approval-retry',
    createdAt: '2026-08-12T18:00:00.000Z',
    updatedAt: '2026-08-12T18:00:00.000Z',
  };

  return {
    task: options.approvalOwner ? { ...task, approvalOwner: options.approvalOwner } : task,
    version: 1,
    persistedAt: '2026-08-12T18:00:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord | null;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(record: AgentRuntimeExecutionRecord) {
    this.execution = record;
  }

  async getExecution(executionId: string): Promise<AgentRuntimeExecutionRecord | null> {
    return this.execution?.task.executionId === executionId ? this.execution : null;
  }

  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number): Promise<void> {
    if (!this.execution || this.execution.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId);
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

function createHarness(record: AgentRuntimeExecutionRecord) {
  const store = new MemoryRuntimeStore(record);
  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead',
    async execute(task) {
      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: 'lead_agent',
        status: 'completed',
        output: { route: 'primary' },
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 0.95,
      };
    },
  });
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead_fallback',
    async execute(task) {
      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: 'lead_agent',
        status: 'completed',
        output: { route: 'fallback' },
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 0.9,
      };
    },
  });

  let eventId = 0;
  let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-12T18:10:${String(second++).padStart(2, '0')}.000Z`,
    createEventId: () => `approval-retry-event-${++eventId}`,
  });

  return { store, orchestrator };
}

test('approval-required execution enters review without invoking destination handler', async () => {
  const { store, orchestrator } = createHarness(sampleRecord({ approvalRequired: true, approvalOwner: 'executive_agent' }));
  const outcome = await orchestrator.execute({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });

  assert.equal(outcome.record.task.status, 'review');
  assert.equal(outcome.record.task.nextAction, 'obtain_required_approval');
  assert.equal(store.events[0]?.type, 'approval_requested');
  assert.equal(store.events[1]?.toStatus, 'review');
});

test('authorised approval resumes execution and clears the approval gate', async () => {
  const { orchestrator } = createHarness(sampleRecord({ approvalRequired: true, approvalOwner: 'executive_agent' }));
  await orchestrator.execute({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });
  const approved = await orchestrator.resolveApproval({
    executionId: 'exec-approval-retry',
    actor: 'executive_agent',
    decision: 'approved',
  });

  assert.equal(approved.record.task.status, 'ready');
  assert.equal(approved.record.task.approvalRequired, false);
  assert.equal(approved.record.task.nextAction, 'execute_destination_capability');

  const completed = await orchestrator.execute({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });
  assert.equal(completed.record.task.status, 'completed');
});

test('approval cannot be resolved by an actor other than the configured approval owner', async () => {
  const { orchestrator } = createHarness(sampleRecord({ approvalRequired: true, approvalOwner: 'executive_agent' }));
  await orchestrator.execute({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });

  await assert.rejects(
    () => orchestrator.resolveApproval({ executionId: 'exec-approval-retry', actor: 'human_executive', decision: 'approved' }),
    /must be resolved by executive_agent/,
  );
});

test('rejected approval escalates the execution', async () => {
  const { orchestrator } = createHarness(sampleRecord({ approvalRequired: true, approvalOwner: 'human_executive' }));
  await orchestrator.execute({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });
  const rejected = await orchestrator.resolveApproval({
    executionId: 'exec-approval-retry',
    actor: 'human_executive',
    decision: 'rejected',
    reason: 'Commercial authority withheld',
  });

  assert.equal(rejected.record.task.status, 'escalated');
  assert.equal(rejected.record.task.nextAction, 'resolve_rejected_approval');
});

test('first routine failure schedules same-capability retry and increments the attempt', async () => {
  const { orchestrator } = createHarness(sampleRecord({ status: 'failed', attempt: 1 }));
  const retried = await orchestrator.retry({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });

  assert.equal(retried.route, 'retry_same');
  assert.equal(retried.nextCapabilityId, 'qualify_lead');
  assert.equal(retried.record.task.status, 'ready');
  assert.equal(retried.record.task.attempt, 2);
  assert.equal(retried.record.task.context.runtimeRetryCapabilityId, 'qualify_lead');
});

test('second routine failure requires an explicitly registered alternative capability', async () => {
  const { orchestrator } = createHarness(sampleRecord({ status: 'failed', attempt: 2 }));
  const retried = await orchestrator.retry({
    executionId: 'exec-approval-retry',
    capabilityId: 'qualify_lead',
    alternativeCapabilityId: 'qualify_lead_fallback',
  });

  assert.equal(retried.route, 'retry_alternative');
  assert.equal(retried.nextCapabilityId, 'qualify_lead_fallback');
  assert.equal(retried.record.task.attempt, 3);
  assert.equal(retried.record.task.nextAction, 'retry_alternative_capability');
});

test('max-attempt and high-risk retries escalate instead of redispatching', async () => {
  const maxed = createHarness(sampleRecord({ status: 'failed', attempt: 3, maxAttempts: 3 }));
  const maxOutcome = await maxed.orchestrator.retry({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });
  assert.equal(maxOutcome.route, 'escalate');
  assert.equal(maxOutcome.record.task.status, 'escalated');

  const critical = createHarness(sampleRecord({ status: 'failed', attempt: 1, priority: 'critical' }));
  const criticalOutcome = await critical.orchestrator.retry({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });
  assert.equal(criticalOutcome.route, 'escalate');
  assert.equal(criticalOutcome.record.task.status, 'escalated');
});

test('attempt-scoped dispatch idempotency permits a legitimate retry execution', async () => {
  const { store, orchestrator } = createHarness(sampleRecord({ status: 'failed', attempt: 1 }));
  store.idempotency.set('runtime:exec-approval-retry:dispatch:qualify_lead:1', {
    idempotencyKey: 'runtime:exec-approval-retry:dispatch:qualify_lead:1',
    executionId: 'exec-approval-retry',
    eventId: 'old-dispatch',
    operation: 'status_transitioned',
    firstSeenAt: '2026-08-12T18:00:00.000Z',
    completed: true,
  });

  await orchestrator.retry({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });
  const completed = await orchestrator.execute({ executionId: 'exec-approval-retry', capabilityId: 'qualify_lead' });

  assert.equal(completed.replayed, false);
  assert.equal(completed.record.task.status, 'completed');
});
