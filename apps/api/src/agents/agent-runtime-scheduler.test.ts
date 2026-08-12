import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { canScheduleForCapacity, rankRuntimeQueue, scheduleRuntimeTasks, type AgentCapacity } from './agent-runtime-scheduler.js';

function task(taskId: string, overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId,
    executionId: `exec-${taskId}`,
    originAgent: 'operations_agent',
    destinationAgent: 'production_agent',
    objective: 'execute task',
    priority: 'normal',
    context: {},
    knowledgeReferences: [],
    inputs: {},
    expectedOutput: 'result',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status: 'queued',
    nextAction: 'continue',
    attempt: 1,
    maxAttempts: 3,
    correlationId: `corr-${taskId}`,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

const available: AgentCapacity = {
  agentId: 'production_agent',
  state: 'available',
  activeTasks: 0,
  maxConcurrentTasks: 2,
};

test('runtime queue ranks critical work before lower priority work', () => {
  const ranked = rankRuntimeQueue([
    task('low', { priority: 'low' }),
    task('critical', { priority: 'critical' }),
    task('high', { priority: 'high' }),
  ]);
  assert.deepEqual(ranked.map((item) => item.taskId), ['critical', 'high', 'low']);
});

test('constrained capacity rejects routine work but permits high priority work', () => {
  const constrained: AgentCapacity = { ...available, state: 'constrained' };
  assert.equal(canScheduleForCapacity(task('routine'), constrained), false);
  assert.equal(canScheduleForCapacity(task('urgent', { priority: 'high' }), constrained), true);
});

test('overloaded agents and agents at concurrency limit are not scheduled', () => {
  assert.equal(canScheduleForCapacity(task('a'), { ...available, state: 'overloaded' }), false);
  assert.equal(canScheduleForCapacity(task('b'), { ...available, activeTasks: 2 }), false);
});

test('scheduler waits for dependencies, blocks cycles, and readies safe tasks', () => {
  const completed = task('completed', { status: 'completed' });
  const ready = task('ready', { dependencies: ['completed'], priority: 'high' });
  const waiting = task('waiting', { dependencies: ['missing'] });
  const cycleA = task('cycle-a', { dependencies: ['cycle-b'] });
  const cycleB = task('cycle-b', { dependencies: ['cycle-a'] });

  const decisions = scheduleRuntimeTasks([completed, ready, waiting, cycleA, cycleB], [available]);
  const byId = new Map(decisions.map((decision) => [decision.taskId, decision.decision]));

  assert.equal(byId.get('ready'), 'ready');
  assert.equal(byId.get('waiting'), 'waiting_dependencies');
  assert.equal(byId.get('cycle-a'), 'blocked_cycle');
  assert.equal(byId.get('cycle-b'), 'blocked_cycle');
});
