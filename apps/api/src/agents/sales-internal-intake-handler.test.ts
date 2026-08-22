import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { SALES_INTERNAL_INTAKE_CAPABILITY, salesInternalIntakeHandler } from './sales-internal-intake-handler.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  const now = '2026-08-20T17:42:00.000Z';
  return {
    taskId: 'sales-intake-task:eligibility-1', executionId: 'sales-intake:eligibility-1', originAgent: 'lead_agent', destinationAgent: 'sales_agent',
    objective: 'Intake a human-approved qualified opportunity for internal Sales review without contacting the prospect.', priority: 'normal',
    context: { leadId: 'lead-1', eligibilityRecordId: 'workflow-1' }, knowledgeReferences: ['Volume 1 - Agency/06 Sales System/Sales System.md'],
    inputs: { salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: false },
    expectedOutput: 'A governed internal Sales intake assessment with no prospect contact or outreach.', dependencies: [], risks: [], confidence: 1,
    approvalRequired: false, status: 'ready', nextAction: 'execute_internal_sales_intake', attempt: 1, maxAttempts: 1,
    correlationId: 'corr-1', createdAt: now, updatedAt: now, ...overrides,
  };
}

test('internal Sales intake capability accepts governed package without authorising outreach', async () => {
  const result = await salesInternalIntakeHandler.execute(task());
  assert.equal(salesInternalIntakeHandler.capabilityId, SALES_INTERNAL_INTAKE_CAPABILITY);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.intakeAccepted, true);
  assert.equal(result.output.salesDispatchAuthorised, false);
  assert.equal(result.output.outreachAuthorised, false);
  assert.equal(result.output.nextAction, 'define_governed_sales_opportunity_assessment');
});

test('internal Sales intake rejects any introduced outreach authority', async () => {
  await assert.rejects(
    () => salesInternalIntakeHandler.execute(task({ inputs: { salesIntakeOnly: true, salesDispatchAuthorised: false, outreachAuthorised: true } })),
    /cannot execute with Sales dispatch or outreach authority/i,
  );
});
