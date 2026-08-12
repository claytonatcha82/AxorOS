import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';

function sampleRecord(priority: 'normal' | 'critical' = 'normal'): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'task-1',
      executionId: 'exec-1',
      originAgent: 'operations_agent',
      destinationAgent: 'lead_agent',
      objective: 'Generate qualified opportunities',
      priority,
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
      correlationId: 'corr-1',
      createdAt: '2026-08-12T18:00:00.000Z',
      updatedAt: '2026-08-12T18:00:00.000Z',
    },
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

function deterministicOrchestrator(store: MemoryRuntimeStore, handlers: AgentRuntimeHandlerRegistry) {
  let event = 0;
  let second = 0;
  return createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-12T18:00:0${second++}.000Z`,
    createEventId: () => `event-${++event}`,
  });
}

test('orchestrator invokes authorised handler and persists completed state plus audit events', async () => {
  const store = new MemoryRuntimeStore(sampleRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead',
    async execute(task) {
      assert.equal(task.status, 'in_progress');
      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: 'lead_agent',
        status: 'completed',
        output: { leadScore: 91 },
        evidenceReferences: ['evidence-1'],
        knowledgeReferences: [],
        confidence: 0.95,
        completedAt: '2026-08-12T18:00:05.000Z',
      };
    },
  });

  const outcome = await deterministicOrchestrator(store, handlers).execute({ executionId: 'exec-1', capabilityId: 'qualify_lead' });

  assert.equal(outcome.replayed, false);
  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed');
  assert.equal(outcome.record.version, 3);
  assert.equal(store.events.length, 2);
  assert.equal(store.idempotency.size, 2);
});

test('orchestrator blocks replay before invoking a handler twice', async () => {
  const store = new MemoryRuntimeStore(sampleRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  let invocations = 0;
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead',
    async execute(task) {
      invocations += 1;
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

  const orchestrator = deterministicOrchestrator(store, handlers);
  await orchestrator.execute({ executionId: 'exec-1', capabilityId: 'qualify_lead' });
  const replay = await orchestrator.execute({ executionId: 'exec-1', capabilityId: 'qualify_lead' });

  assert.equal(invocations, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.task.status, 'completed');
});

test('orchestrator normalizes routine handler failure into failed state with retry route', async () => {
  const store = new MemoryRuntimeStore(sampleRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead',
    async execute() {
      throw new Error('provider unavailable');
    },
  });

  const outcome = await deterministicOrchestrator(store, handlers).execute({ executionId: 'exec-1', capabilityId: 'qualify_lead' });

  assert.equal(outcome.record.task.status, 'failed');
  assert.equal(outcome.record.result?.errorCode, 'RUNTIME_HANDLER_FAILURE');
  assert.equal(store.events[1]?.payload.retryRoute, 'retry_same');
});

test('orchestrator escalates critical handler failures instead of retrying automatically', async () => {
  const store = new MemoryRuntimeStore(sampleRecord('critical'));
  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead',
    async execute() {
      throw new Error('critical failure');
    },
  });

  const outcome = await deterministicOrchestrator(store, handlers).execute({ executionId: 'exec-1', capabilityId: 'qualify_lead' });

  assert.equal(outcome.record.task.status, 'escalated');
  assert.equal(store.events[1]?.payload.retryRoute, 'escalate');
});

test('orchestrator rejects mismatched handler results and records them as runtime failures', async () => {
  const store = new MemoryRuntimeStore(sampleRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register({
    agentId: 'lead_agent',
    capabilityId: 'qualify_lead',
    async execute(task) {
      return {
        executionId: 'wrong-execution',
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

  const outcome = await deterministicOrchestrator(store, handlers).execute({ executionId: 'exec-1', capabilityId: 'qualify_lead' });
  assert.equal(outcome.record.task.status, 'failed');
  assert.match(outcome.record.result?.errorMessage ?? '', /executionId does not match/);
});
