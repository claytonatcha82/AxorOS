import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateOperationsEmailApproval } from './operations-email-approval-policy.js';

function task(context: Record<string, unknown> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-operations-email-approval', executionId: 'exec-operations-email-approval', originAgent: 'executive_agent', destinationAgent: 'operations_agent',
    objective: 'Draft external Operations communication', priority: 'normal', context, knowledgeReferences: ['atlas://operations/communication-governance'], inputs: {},
    expectedOutput: 'Operations communication draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability',
    attempt: 1, maxAttempts: 3, correlationId: 'corr-operations-email-approval', createdAt: '2026-08-17T20:49:00.000Z', updatedAt: '2026-08-17T20:49:00.000Z',
  };
}

test('Operations Stage 1 external draft requires Human Executive approval', () => {
  const decision = evaluateOperationsEmailApproval(task());
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.approvalOwner, 'human_executive');
  assert.match(decision.reason, /Operations Copilot/);
});

test('synthetic development-only Operations draft does not require approval', () => {
  const decision = evaluateOperationsEmailApproval(task({ testOnly: true }));
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.approvalOwner, undefined);
});

test('Operations email approval policy rejects tasks for another agent', () => {
  const invalid = { ...task(), destinationAgent: 'sales_agent' as const };
  assert.throws(() => evaluateOperationsEmailApproval(invalid), /requires destinationAgent operations_agent/);
});
