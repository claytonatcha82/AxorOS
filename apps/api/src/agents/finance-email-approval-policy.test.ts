import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { evaluateFinanceEmailApproval } from './finance-email-approval-policy.js';

function task(context: Record<string, unknown> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-finance-email-approval', executionId: 'exec-finance-email-approval', originAgent: 'operations_agent', destinationAgent: 'finance_agent',
    objective: 'Draft client-facing financial communication', priority: 'normal', context, knowledgeReferences: ['atlas://finance/governance'], inputs: {},
    expectedOutput: 'Finance communication draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability',
    attempt: 1, maxAttempts: 3, correlationId: 'corr-finance-email-approval', createdAt: '2026-08-17T19:52:00.000Z', updatedAt: '2026-08-17T19:52:00.000Z',
  };
}

test('Finance Stage 1 external client-facing draft requires Human Executive approval', () => {
  const decision = evaluateFinanceEmailApproval(task());
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.approvalOwner, 'human_executive');
  assert.match(decision.reason, /Finance Copilot/);
});

test('synthetic development-only Finance draft does not require approval', () => {
  const decision = evaluateFinanceEmailApproval(task({ testOnly: true }));
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.approvalOwner, undefined);
});

test('Finance email approval policy rejects tasks for another agent', () => {
  const invalid = { ...task(), destinationAgent: 'sales_agent' as const };
  assert.throws(() => evaluateFinanceEmailApproval(invalid), /requires destinationAgent finance_agent/);
});
