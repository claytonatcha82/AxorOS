import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';

function failedRecord(): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'task-retry-2',
      executionId: 'exec-retry-2',
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
      confidence: 0.8,
      approvalRequired: false,
      status: 'failed',
      nextAction: 'schedule_governed_retry',
      attempt: 2,
      maxAttempts: 3,
      correlationId: 'corr-retry-2',
      createdAt: '2026-08-12T19:00:00.000Z',
      updatedAt: '2026-08-12T19:01:00.000Z',
    },
    version: 2,
    persistedAt: '2026-08-12T19:01:00.000Z',
  };
}

class MemoryStore implements AgentRuntimeStore {
  record: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(record: AgentRuntimeExecutionRecord) {
    this.record = record;
  }

  async getExecution(executionId: string) {
    return this.record.task.executionId === executionId ? this.record : null;
  }

  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number) {
    if (this.record.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId);
    this.record = record;
  }

  async appendEvent(event: AgentRuntimeEvent) {
    this.events.push(event);
  }

  async listEvents(executionId: string) {
    return this.events.filter((event) => event.executionId === executionId);
  }

  async hasIdempotencyKey(key: string) {
    return this.idempotency.has(key);
  }

  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord) {
    this.idempotency.set(record.idempotencyKey, record);
  }
}

function orchestrator(store: MemoryStore, handlers: AgentRuntimeHandlerRegistry) {
  let eventId = 0;
  return createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => '2026-08-12T19:05:00.000Z',
    createEventId: () => `retry-event-${++eventId}`,
  });
}

test('retry_alternative escalates when no alternative capability is supplied', async () => {
  const store = new MemoryStore(failedRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  const outcome = await orchestrator(store, handlers).retry({
    executionId: 'exec-retry-2',
    capabilityId: 'qualify_lead',
  });

  assert.equal(outcome.route, 'escalate');
  assert.equal(outcome.record.task.status, 'escalated');
  assert.equal(outcome.record.task.nextAction, 'operations_resolve_retry_alternative');
  assert.equal(store.events.at(-1)?.payload.reason, 'alternative_capability_missing');
});

test('retry_alternative escalates when fallback capability is unregistered', async () => {
  const store = new MemoryStore(failedRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  const outcome = await orchestrator(store, handlers).retry({
    executionId: 'exec-retry-2',
    capabilityId: 'qualify_lead',
    alternativeCapabilityId: 'qualify_lead_fallback',
  });

  assert.equal(outcome.route, 'escalate');
  assert.equal(outcome.record.task.status, 'escalated');
  assert.equal(store.events.at(-1)?.payload.reason, 'alternative_capability_unavailable');
});

test('retry_alternative schedules a distinct registered fallback capability', async () => {
  const store = new MemoryStore(failedRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead_fallback',
    async execute(task) {
      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: 'lead_agent',
        status: 'completed',
        output: {},
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 1,
      };
    },
  });

  const outcome = await orchestrator(store, handlers).retry({
    executionId: 'exec-retry-2',
    capabilityId: 'qualify_lead',
    alternativeCapabilityId: 'qualify_lead_fallback',
  });

  assert.equal(outcome.route, 'retry_alternative');
  assert.equal(outcome.nextCapabilityId, 'qualify_lead_fallback');
  assert.equal(outcome.record.task.status, 'ready');
  assert.equal(outcome.record.task.attempt, 3);
  assert.equal(outcome.record.task.context.runtimeRetryCapabilityId, 'qualify_lead_fallback');
});
