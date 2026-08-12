import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { findCircularDependencies, resolveTaskDependencies, taskParticipatesInCycle } from './agent-runtime-dependencies.js';

function task(taskId: string, dependencies: string[], status: AgentRuntimeTask['status'] = 'queued'): AgentRuntimeTask {
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
    dependencies,
    risks: [],
    confidence: 1,
    approvalRequired: false,
    status,
    nextAction: 'continue',
    attempt: 1,
    maxAttempts: 3,
    correlationId: `corr-${taskId}`,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };
}

test('dependencies are ready only when every dependency exists and is completed', () => {
  const a = task('a', []);
  const b = task('b', ['a']);
  const pending = resolveTaskDependencies(b, new Map([[a.taskId, a]]));
  assert.equal(pending.ready, false);
  assert.deepEqual(pending.incompleteDependencies, ['a']);

  a.status = 'completed';
  const ready = resolveTaskDependencies(b, new Map([[a.taskId, a]]));
  assert.equal(ready.ready, true);
});

test('missing dependencies are reported explicitly', () => {
  const result = resolveTaskDependencies(task('b', ['missing']), new Map());
  assert.deepEqual(result.missingDependencies, ['missing']);
});

test('circular dependencies are detected and attributable to participating tasks', () => {
  const cycles = findCircularDependencies([
    task('a', ['b']),
    task('b', ['c']),
    task('c', ['a']),
  ]);
  assert.equal(cycles.length, 1);
  assert.equal(taskParticipatesInCycle('b', cycles), true);
  assert.equal(taskParticipatesInCycle('x', cycles), false);
});
