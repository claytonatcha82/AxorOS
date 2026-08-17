import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateSupportEmailApproval } from './support-email-approval-policy.js';

function task(context: Record<string, unknown> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-support-email-approval', executionId: 'exec-support-email-approval', originAgent: 'operations_agent', destinationAgent: 'support_agent',
    objective: 'Draft a client-facing Support response', priority: 'normal', context, knowledgeReferences: ['atlas://support/client-communication'], inputs: {},
    expectedOutput: 'Support response draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability',
    attempt: 1, maxAttempts: 3, correlationId: 'corr-support-email-approval', createdAt: '2026-08-17T15:06:00.000Z', updatedAt: '2026-08-17T15:06:00.000Z',
  };
}

test('Support V1 external client-facing draft requires Human Executive approval', () => {
  const decision = evaluateSupportEmailApproval(task());
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.approvalOwner, 'human_executive');
  assert.match(decision.reason, /Support Copilot/);
});

test('synthetic development-only Support draft does not require approval', () => {
  const decision = evaluateSupportEmailApproval(task({ testOnly: true }));
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.approvalOwner, undefined);
});

test('Support email approval policy rejects tasks for another agent', () => {
  const invalid = { ...task(), destinationAgent: 'sales_agent' as const };
  assert.throws(() => evaluateSupportEmailApproval(invalid), /requires destinationAgent support_agent/);
});
