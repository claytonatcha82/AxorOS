import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { applySalesEmailRuntimeApprovalPolicy } from './sales-email-runtime-approval.js';

function task(context: Record<string, unknown> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-sales-runtime-approval', executionId: 'exec-sales-runtime-approval', originAgent: 'operations_agent', destinationAgent: 'sales_agent',
    objective: 'Create governed Sales email draft', priority: 'normal', context, knowledgeReferences: ['atlas://sales/outreach-policy'], inputs: {},
    expectedOutput: 'Draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability',
    attempt: 1, maxAttempts: 3, correlationId: 'corr-sales-runtime-approval', createdAt: '2026-08-17T14:50:00.000Z', updatedAt: '2026-08-17T14:50:00.000Z',
  };
}

test('prepares real Sales email task for Stage 1 human executive approval', () => {
  const prepared = applySalesEmailRuntimeApprovalPolicy(task());
  assert.equal(prepared.approvalRequired, true);
  assert.equal(prepared.approvalOwner, 'human_executive');
  assert.equal(prepared.nextAction, 'obtain_required_approval');
  assert.deepEqual(prepared.context.salesEmailApprovalPolicy, {
    stage: 1,
    source: 'atlas_os',
    reason: 'Any non-test Sales email draft intended for an external prospect or client requires human executive approval before Gmail draft creation.',
  });
});

test('leaves synthetic development-only Sales email task ungated', () => {
  const original = task({ testOnly: true });
  const prepared = applySalesEmailRuntimeApprovalPolicy(original);
  assert.equal(prepared, original);
  assert.equal(prepared.approvalRequired, false);
});
