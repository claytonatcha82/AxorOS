import assert from 'node:assert/strict';
import test from 'node:test';
import { hasDependencyCycle, operationsRetryAction, unresolvedDependencies, type OperationsDependencyTask } from './operations-dependency-retry.js';

const tasks: OperationsDependencyTask[] = [
  { taskId: 'TASK-001', dependencies: [], status: 'completed' },
  { taskId: 'TASK-002', dependencies: ['TASK-001'], status: 'ready' },
  { taskId: 'TASK-003', dependencies: ['TASK-002'], status: 'queued' },
];

test('operations identifies unresolved dependencies before task execution', () => {
  assert.deepEqual(unresolvedDependencies(tasks[1]!, tasks), []);
  assert.deepEqual(unresolvedDependencies(tasks[2]!, tasks), ['TASK-002']);
});

test('operations detects dependency cycles and deadlock risk', () => {
  assert.equal(hasDependencyCycle(tasks), false);
  const cyclic: OperationsDependencyTask[] = [
    { taskId: 'A', dependencies: ['B'], status: 'waiting' },
    { taskId: 'B', dependencies: ['A'], status: 'waiting' },
  ];
  assert.equal(hasDependencyCycle(cyclic), true);
});

test('retry policy follows retry alternative then escalate', () => {
  assert.equal(operationsRetryAction(1), 'retry_automatically');
  assert.equal(operationsRetryAction(2), 'alternative_approach');
  assert.equal(operationsRetryAction(3), 'escalate');
  assert.equal(operationsRetryAction(6), 'escalate');
});

test('high-risk workflows permit zero automatic retries', () => {
  assert.equal(operationsRetryAction(1, true), 'no_retry');
});
