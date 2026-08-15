import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { createProductionRuntimeExecutor } from './agent-runtime-production-executor.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-1',
    executionId: 'exec-1',
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
    correlationId: 'corr-1',
    createdAt: '2026-08-15T09:20:00.000Z',
    updatedAt: '2026-08-15T09:20:00.000Z',
    ...overrides,
  };
}

test('production executor always supplies tasks and destination capacity to orchestrator', async () => {
  const current = task();
  let received: Record<string, unknown> | undefined;

  const executor = createProductionRuntimeExecutor({
    orchestrator: {
      async execute(input) {
        received = input as unknown as Record<string, unknown>;
        return {
          record: {
            task: { ...current, status: 'completed' },
            version: 2,
            persistedAt: '2026-08-15T09:20:01.000Z',
          },
          replayed: false,
        };
      },
    },
    schedulingSource: {
      async listSchedulingTasks() {
        return [current];
      },
      async getAgentCapacity(agentId) {
        return { agentId, state: 'available', activeTasks: 0, maxConcurrentTasks: 2 };
      },
    },
  });

  await executor.execute({ executionId: 'exec-1', capabilityId: 'draft_marketing_copy' });

  assert.ok(received);
  const scheduling = received.scheduling as {
    tasks: AgentRuntimeTask[];
    capacity: { agentId: string; state: string };
  };
  assert.equal(scheduling.tasks.length, 1);
  assert.equal(scheduling.tasks[0]?.executionId, 'exec-1');
  assert.equal(scheduling.capacity.agentId, 'marketing_agent');
  assert.equal(scheduling.capacity.state, 'available');
});

test('production executor refuses scheduling context that omits the current execution', async () => {
  const executor = createProductionRuntimeExecutor({
    orchestrator: {
      async execute() {
        throw new Error('orchestrator must not run');
      },
    },
    schedulingSource: {
      async listSchedulingTasks() {
        return [task({ executionId: 'other-exec', taskId: 'other-task' })];
      },
      async getAgentCapacity(agentId) {
        return { agentId, state: 'available', activeTasks: 0, maxConcurrentTasks: 2 };
      },
    },
  });

  await assert.rejects(
    () => executor.execute({ executionId: 'exec-1', capabilityId: 'draft_marketing_copy' }),
    /did not return execution exec-1/,
  );
});

test('production executor refuses capacity for the wrong destination agent', async () => {
  const executor = createProductionRuntimeExecutor({
    orchestrator: {
      async execute() {
        throw new Error('orchestrator must not run');
      },
    },
    schedulingSource: {
      async listSchedulingTasks() {
        return [task()];
      },
      async getAgentCapacity() {
        return { agentId: 'sales_agent', state: 'available', activeTasks: 0, maxConcurrentTasks: 2 };
      },
    },
  });

  await assert.rejects(
    () => executor.execute({ executionId: 'exec-1', capabilityId: 'draft_marketing_copy' }),
    /capacity mismatch/,
  );
});
