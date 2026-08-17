import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateSalesEmailApproval } from './sales-email-approval-policy.js';

function task(testOnly?: boolean): AgentRuntimeTask {
  return {
    taskId: 'task-sales-email-approval', executionId: 'exec-sales-email-approval', originAgent: 'operations_agent', destinationAgent: 'sales_agent',
    objective: 'Create a governed Sales email draft', priority: 'normal', context: testOnly === undefined ? {} : { testOnly }, knowledgeReferences: [], inputs: {},
    expectedOutput: 'Draft', dependencies: [], risks: [], confidence: 1, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability',
    attempt: 1, maxAttempts: 1, correlationId: 'corr-sales-email-approval', createdAt: '2026-08-17T14:00:00.000Z', updatedAt: '2026-08-17T14:00:00.000Z',
  };
}

test('requires human executive approval for a non-test Sales email draft', () => {
  assert.deepEqual(evaluateSalesEmailApproval(task()), {
    approvalRequired: true,
    approvalOwner: 'human_executive',
    reason: 'Any non-test Sales email draft intended for an external prospect or client requires human executive approval before Gmail draft creation.',
  });
});

test('permits synthetic development-only self drafts without human approval', () => {
  const decision = evaluateSalesEmailApproval(task(true));
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.approvalOwner, undefined);
});

test('does not treat explicit testOnly false as a test draft', () => {
  assert.equal(evaluateSalesEmailApproval(task(false)).approvalRequired, true);
});
