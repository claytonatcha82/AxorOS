import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateMarketingEmailApproval } from './marketing-email-approval-policy.js';

function task(context: Record<string, unknown> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-marketing-email-approval', executionId: 'exec-marketing-email-approval', originAgent: 'operations_agent', destinationAgent: 'marketing_agent',
    objective: 'Draft external Marketing communication', priority: 'normal', context, knowledgeReferences: ['atlas://marketing/communication-governance'], inputs: {},
    expectedOutput: 'Marketing communication draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability',
    attempt: 1, maxAttempts: 3, correlationId: 'corr-marketing-email-approval', createdAt: '2026-08-17T20:23:00.000Z', updatedAt: '2026-08-17T20:23:00.000Z',
  };
}

test('Marketing Stage 1 external draft requires Human Executive approval', () => {
  const decision = evaluateMarketingEmailApproval(task());
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.approvalOwner, 'human_executive');
  assert.match(decision.reason, /Marketing Copilot/);
});

test('synthetic development-only Marketing draft does not require approval', () => {
  const decision = evaluateMarketingEmailApproval(task({ testOnly: true }));
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.approvalOwner, undefined);
});

test('Marketing email approval policy rejects tasks for another agent', () => {
  const invalid = { ...task(), destinationAgent: 'sales_agent' as const };
  assert.throws(() => evaluateMarketingEmailApproval(invalid), /requires destinationAgent marketing_agent/);
});
