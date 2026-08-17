import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { createMarketingEmailDraftHandler, MARKETING_EMAIL_DRAFT_CAPABILITY } from './marketing-email-capabilities.js';
import { DeterministicDraftEmailIntegration } from '../integrations/deterministic-draft-email-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';

function marketingTask(fromIdentity = 'marketing'): AgentRuntimeTask {
  return {
    taskId: 'task-marketing-email-draft',
    executionId: 'exec-marketing-email-draft',
    originAgent: 'operations_agent',
    destinationAgent: 'marketing_agent',
    objective: 'Prepare a governed Marketing communication draft',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic', testOnly: true },
    knowledgeReferences: ['atlas://marketing/communication-governance'],
    inputs: {
      fromIdentity,
      to: [{ email: 'subscriber@example.test' }],
      subject: 'Synthetic agency update',
      textBody: 'Synthetic Marketing draft content. No fabricated claims, sales negotiation, or external sending authority is implied.',
    },
    expectedOutput: 'Governed Marketing email draft',
    dependencies: [],
    risks: [],
    confidence: 0.95,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'create_marketing_email_draft',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-marketing-email-draft',
    createdAt: '2026-08-17T20:20:00.000Z',
    updatedAt: '2026-08-17T20:20:00.000Z',
  };
}

function createHarness() {
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicDraftEmailIntegration());
  return createMarketingEmailDraftHandler(integrations);
}

test('Marketing creates a draft through the safe default email integration and preserves knowledge references', async () => {
  const handler = createHarness();
  assert.equal(handler.agentId, 'marketing_agent');
  assert.equal(handler.capabilityId, MARKETING_EMAIL_DRAFT_CAPABILITY);
  const result = await handler.execute(marketingTask());
  assert.equal(result.status, 'completed');
  assert.equal(result.agentId, 'marketing_agent');
  assert.equal(result.output.integrationId, 'email.draft');
  assert.equal(result.output.mode, 'draft');
  assert.equal(result.output.fromIdentity, 'marketing');
  assert.deepEqual(result.knowledgeReferences, ['atlas://marketing/communication-governance']);
});

test('Marketing cannot spoof the Sales email identity', async () => {
  const handler = createHarness();
  await assert.rejects(() => handler.execute(marketingTask('sales')), /marketing_agent may not use email identity sales/);
});

test('Marketing draft capability cannot be used for a different destination agent', async () => {
  const handler = createHarness();
  const task = { ...marketingTask(), destinationAgent: 'sales_agent' as const };
  await assert.rejects(() => handler.execute(task), /requires destinationAgent marketing_agent/);
});
