import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAgentRuntimeTask, type AgentRuntimeTask } from './agent-runtime-contract.js';

function validTask(): AgentRuntimeTask {
  return {
    taskId: 'task-1', executionId: 'exec-1', originAgent: 'operations_agent', destinationAgent: 'production_agent',
    objective: 'Build approved client website.', priority: 'high', context: {}, knowledgeReferences: ['atlas://delivery'], inputs: {},
    expectedOutput: 'Deployment-ready project', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false,
    status: 'ready', nextAction: 'begin execution', attempt: 1, maxAttempts: 3, correlationId: 'corr-1',
    createdAt: '2026-08-12T00:00:00Z', updatedAt: '2026-08-12T00:00:00Z',
  };
}

test('valid shared runtime task satisfies contract', () => {
  assert.deepEqual(validateAgentRuntimeTask(validTask()), []);
});

test('approval-gated task requires approval owner', () => {
  const task = validTask();
  task.approvalRequired = true;
  assert.ok(validateAgentRuntimeTask(task).includes('approvalOwner is required when approvalRequired is true.'));
});

test('runtime validates retries and confidence deterministically', () => {
  const task = validTask();
  task.attempt = 4;
  task.maxAttempts = 3;
  task.confidence = 1.2;
  const errors = validateAgentRuntimeTask(task);
  assert.ok(errors.includes('attempt cannot exceed maxAttempts.'));
  assert.ok(errors.includes('confidence must be between 0 and 1.'));
});
