import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-main',
    executionId: 'exec-main',
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'Deliver approved project',
    priority: 'normal',
    context: {},
    knowledgeReferences: [],
    inputs: {},
    expectedOutput: 'Production-ready deliverable',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-main',
    createdAt: '2026-08-12T18:00:00.000Z',
    updatedAt: '2026-08-12T18:00:00.000Z',
    ...overrides,
  };
}

function dependency(id: string, status: AgentRuntimeTask['status']): AgentRuntimeTask {
  return task({
    taskId: id,
    executionId: `exec-${id}`,
    destinationAgent: 'sales_agent',
    objective: `Dependency ${id}`,
    expectedOutput: `Completed ${id}`,
    dependencies: [],
    status,
    correlationId: `corr-${id}`,
  });
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

function record(runtimeTask: AgentRuntimeTask): AgentRuntimeExecutionRecord {
  return {
    task: runtimeTask,
    version: 1,
    persistedAt: '2026-08-12T18:00:00.000Z',
  };
}

function orchestrator(store: MemoryRuntimeStore, invocations: { count: number }) {
  const handlers = new AgentRuntimeHandlerRegistry();
  handlers.register({
    agentId: 'production_agent',
    capabilityId: 'build_project',
    async execute(runtimeTask) {
      invocations.count += 1;
      return {
        executionId: runtimeTask.executionId,
        taskId: runtimeTask.taskId,
        agentId: 'production_agent',
        status: 'completed',
        output: { delivered: true },
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 1,
      };
    },
  });
  let id = 0;
  return createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => '2026-08-12T18:00:10.000Z',
    createEventId: () => `event-${++id}`,
  });
}

const availableCapacity = {
  agentId: 'production_agent' as const,
  state: 'available' as const,
  activeTasks: 0,
  maxConcurrentTasks: 2,
};

test('incomplete dependency moves a ready execution to waiting before handler invocation', async () => {
  const runtimeTask = task({ dependencies: ['task-dep'] });
  const store = new MemoryRuntimeStore(record(runtimeTask));
  const invocations = { count: 0 };

  const outcome = await orchestrator(store, invocations).execute({
    executionId: runtimeTask.executionId,
    capabilityId: 'build_project',
    scheduling: { tasks: [dependency('task-dep', 'in_progress')], capacity: availableCapacity },
  });

  assert.equal(outcome.record.task.status, 'waiting');
  assert.equal(outcome.record.task.nextAction, 'wait_for_dependencies');
  assert.equal(invocations.count, 0);
});

test('missing dependency waits rather than guessing that prerequisite state', async () => {
  const runtimeTask = task({ dependencies: ['missing-task'] });
  const store = new MemoryRuntimeStore(record(runtimeTask));
  const invocations = { count: 0 };

  const outcome = await orchestrator(store, invocations).execute({
    executionId: runtimeTask.executionId,
    capabilityId: 'build_project',
    scheduling: { tasks: [], capacity: availableCapacity },
  });

  assert.equal(outcome.record.task.status, 'waiting');
  assert.equal(store.events[0]?.payload.decision, 'waiting_dependencies');
  assert.deepEqual(store.events[0]?.payload.missingDependencies, ['missing-task']);
  assert.equal(invocations.count, 0);
});

test('circular dependency blocks execution for Operations resolution', async () => {
  const runtimeTask = task({ dependencies: ['task-dep'] });
  const circularDependency = dependency('task-dep', 'waiting');
  circularDependency.dependencies = [runtimeTask.taskId];
  const store = new MemoryRuntimeStore(record(runtimeTask));
  const invocations = { count: 0 };

  const outcome = await orchestrator(store, invocations).execute({
    executionId: runtimeTask.executionId,
    capabilityId: 'build_project',
    scheduling: { tasks: [circularDependency], capacity: availableCapacity },
  });

  assert.equal(outcome.record.task.status, 'blocked');
  assert.equal(outcome.record.task.nextAction, 'operations_resolve_dependency_cycle');
  assert.equal(invocations.count, 0);
});

test('overloaded destination capacity defers execution', async () => {
  const runtimeTask = task();
  const store = new MemoryRuntimeStore(record(runtimeTask));
  const invocations = { count: 0 };

  const outcome = await orchestrator(store, invocations).execute({
    executionId: runtimeTask.executionId,
    capabilityId: 'build_project',
    scheduling: {
      tasks: [],
      capacity: { ...availableCapacity, state: 'overloaded', activeTasks: 2 },
    },
  });

  assert.equal(outcome.record.task.status, 'waiting');
  assert.equal(outcome.record.task.nextAction, 'wait_for_destination_capacity');
  assert.equal(invocations.count, 0);
});

test('constrained capacity defers normal priority but permits high priority', async () => {
  const constrained = { ...availableCapacity, state: 'constrained' as const };
  const normalTask = task();
  const normalStore = new MemoryRuntimeStore(record(normalTask));
  const normalInvocations = { count: 0 };
  const normalOutcome = await orchestrator(normalStore, normalInvocations).execute({
    executionId: normalTask.executionId,
    capabilityId: 'build_project',
    scheduling: { tasks: [], capacity: constrained },
  });
  assert.equal(normalOutcome.record.task.status, 'waiting');
  assert.equal(normalInvocations.count, 0);

  const highTask = task({ priority: 'high' });
  const highStore = new MemoryRuntimeStore(record(highTask));
  const highInvocations = { count: 0 };
  const highOutcome = await orchestrator(highStore, highInvocations).execute({
    executionId: highTask.executionId,
    capabilityId: 'build_project',
    scheduling: { tasks: [], capacity: constrained },
  });
  assert.equal(highOutcome.record.task.status, 'completed');
  assert.equal(highInvocations.count, 1);
});

test('waiting execution resumes when dependencies complete and capacity becomes safe', async () => {
  const runtimeTask = task({ status: 'waiting', dependencies: ['task-dep'], nextAction: 'wait_for_dependencies' });
  const store = new MemoryRuntimeStore(record(runtimeTask));
  const invocations = { count: 0 };

  const outcome = await orchestrator(store, invocations).execute({
    executionId: runtimeTask.executionId,
    capabilityId: 'build_project',
    scheduling: { tasks: [dependency('task-dep', 'completed')], capacity: availableCapacity },
  });

  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(invocations.count, 1);
  assert.equal(store.events.some((runtimeEvent) => runtimeEvent.fromStatus === 'waiting' && runtimeEvent.toStatus === 'ready'), true);
});
