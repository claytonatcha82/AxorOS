import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { createFinanceEmailDraftHandler, FINANCE_EMAIL_DRAFT_CAPABILITY } from './finance-email-capabilities.js';
import { DeterministicDraftEmailIntegration } from '../integrations/deterministic-draft-email-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';

function financeTask(fromIdentity = 'finance'): AgentRuntimeTask {
  return {
    taskId: 'task-finance-email-draft',
    executionId: 'exec-finance-email-draft',
    originAgent: 'operations_agent',
    destinationAgent: 'finance_agent',
    objective: 'Prepare a governed Finance communication draft',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic', testOnly: true },
    knowledgeReferences: ['atlas://finance/governance'],
    inputs: {
      fromIdentity,
      to: [{ email: 'client@example.test' }],
      subject: 'Invoice clarification',
      textBody: 'Synthetic Finance draft content. No payment status is asserted.',
    },
    expectedOutput: 'Governed Finance email draft',
    dependencies: [],
    risks: [],
    confidence: 0.95,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'create_finance_email_draft',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-finance-email-draft',
    createdAt: '2026-08-17T19:50:00.000Z',
    updatedAt: '2026-08-17T19:50:00.000Z',
  };
}

function createHarness() {
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicDraftEmailIntegration());
  return createFinanceEmailDraftHandler(integrations);
}

test('Finance creates a draft through the safe default email integration and preserves knowledge references', async () => {
  const handler = createHarness();
  assert.equal(handler.agentId, 'finance_agent');
  assert.equal(handler.capabilityId, FINANCE_EMAIL_DRAFT_CAPABILITY);
  const result = await handler.execute(financeTask());
  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'finance_agent');
  assert.equal(result.output.integrationId, 'email.draft');
  assert.equal(result.output.mode, 'draft');
  assert.equal(result.output.fromIdentity, 'finance');
  assert.deepEqual(result.knowledgeReferences, ['atlas://finance/governance']);
});

test('Finance cannot spoof the Sales email identity', async () => {
  const handler = createHarness();
  await assert.rejects(() => handler.execute(financeTask('sales')), /finance_agent may not use email identity sales/);
});

test('Finance draft capability cannot be used for a different destination agent', async () => {
  const handler = createHarness();
  const task = { ...financeTask(), destinationAgent: 'support_agent' as const };
  await assert.rejects(() => handler.execute(task), /requires destinationAgent finance_agent/);
});
