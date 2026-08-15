import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import { createProductionRuntimeExecutor } from './agent-runtime-production-executor.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';

function runtimeTask(): AgentRuntimeTask {
  return {
    taskId: 'task-production-1',
    executionId: 'exec-production-1',
    originAgent: 'operations_agent',
    destinationAgent: 'marketing_agent',
    objective: 'Draft marketing copy',
    priority: 'normal',
    context: {},
    knowledgeReferences: [],
    inputs: { brief: 'Draft a headline.' },
    expectedOutput: 'Draft copy',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-production-1',
    createdAt: '2026-08-15T09:20:00.000Z',
    updatedAt: '2026-08-15T09:20:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(task: AgentRuntimeTask) {
    this.execution = {
      task,
      version: 1,
      persistedAt: '2026-08-15T09:20:00.000Z',
    };
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

test('production execution defers constrained destination capacity before handler dispatch', async () => {
  const task = runtimeTask();
  const store = new MemoryRuntimeStore(task);
  const handlers = new AgentRuntimeHandlerRegistry();
  let handlerInvocations = 0;

  handlers.register({
    agentId: 'marketing_agent',
    capabilityId: 'draft_marketing_copy',
    async execute(currentTask) {
      handlerInvocations += 1;
      return {
        executionId: currentTask.executionId,
        taskId: currentTask.taskId,
        agentId: 'marketing_agent',
        status: 'completed',
        output: { text: 'should not execute' },
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 1,
      };
    },
  });

  let eventId = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => '2026-08-15T09:20:01.000Z',
    createEventId: () => `production-event-${++eventId}`,
  });

  const production = createProductionRuntimeExecutor({
    orchestrator,
    schedulingSource: {
      async listSchedulingTasks() {
        return [store.execution.task];
      },
      async getAgentCapacity(agentId) {
        return {
          agentId,
          state: 'constrained',
          activeTasks: 1,
          maxConcurrentTasks: 2,
        };
      },
    },
  });

  const outcome = await production.execute({
    executionId: task.executionId,
    capabilityId: 'draft_marketing_copy',
  });

  assert.equal(handlerInvocations, 0);
  assert.equal(outcome.record.task.status, 'waiting');
  assert.equal(outcome.record.task.nextAction, 'wait_for_destination_capacity');
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0]?.payload.decision, 'deferred_capacity');
});
