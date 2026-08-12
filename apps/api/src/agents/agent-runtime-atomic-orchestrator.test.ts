import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { AgentRuntimeStore, RuntimeMutation } from './agent-runtime-store.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';

function sampleRecord(): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'task-atomic',
      executionId: 'exec-atomic',
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
      confidence: 0.9,
      approvalRequired: false,
      status: 'ready',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 3,
      correlationId: 'corr-atomic',
      createdAt: '2026-08-12T19:00:00.000Z',
      updatedAt: '2026-08-12T19:00:00.000Z',
    },
    version: 1,
    persistedAt: '2026-08-12T19:00:00.000Z',
  };
}

class AtomicStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord = sampleRecord();
  readonly mutations: RuntimeMutation[] = [];
  readonly idempotency = new Set<string>();

  async getExecution(executionId: string) {
    return executionId === this.execution.task.executionId ? this.execution : null;
  }

  async saveExecution(): Promise<void> {
    throw new Error('legacy saveExecution should not be used');
  }

  async appendEvent(): Promise<void> {
    throw new Error('legacy appendEvent should not be used');
  }

  async listEvents(): Promise<readonly AgentRuntimeEvent[]> {
    return [];
  }

  async hasIdempotencyKey(key: string): Promise<boolean> {
    return this.idempotency.has(key);
  }

  async saveIdempotencyRecord(_record: RuntimeIdempotencyRecord): Promise<void> {
    throw new Error('legacy saveIdempotencyRecord should not be used');
  }

  async commitRuntimeMutation(mutation: RuntimeMutation): Promise<void> {
    this.mutations.push(mutation);
    this.execution = mutation.record;
    this.idempotency.add(mutation.idempotencyRecord.idempotencyKey);
  }
}

test('orchestrator uses atomic mutation commits when the store supports them', async () => {
  const store = new AtomicStore();
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
        output: { qualified: true },
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 0.95,
        completedAt: '2026-08-12T19:00:02.000Z',
      };
    },
  });

  let eventId = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => '2026-08-12T19:00:01.000Z',
    createEventId: () => `atomic-event-${++eventId}`,
  });

  const outcome = await orchestrator.execute({ executionId: 'exec-atomic', capabilityId: 'qualify_lead' });

  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(store.mutations.length, 2);
  assert.equal(store.mutations[0]?.event.toStatus, 'in_progress');
  assert.equal(store.mutations[1]?.event.toStatus, 'completed');
  assert.equal(store.mutations[0]?.expectedVersion, 1);
  assert.equal(store.mutations[1]?.expectedVersion, 2);
});
