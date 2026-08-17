import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerSupportEmailCapabilities, SUPPORT_EMAIL_DRAFT_CAPABILITY } from './support-email-capabilities.js';
import { DeterministicDraftEmailIntegration } from '../integrations/deterministic-draft-email-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';

function task(fromIdentity = 'support') {
  return {
    taskId: 'task-support-email', executionId: 'exec-support-email', originAgent: 'operations_agent' as const, destinationAgent: 'support_agent' as const,
    objective: 'Create governed Support response draft', priority: 'normal' as const, context: { testOnly: true }, knowledgeReferences: ['atlas://support/client-communication'],
    inputs: { fromIdentity, to: [{ email: 'client@example.test' }], subject: 'Support update', textBody: 'Synthetic support response draft.' }, expectedOutput: 'Support email draft',
    dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'in_progress' as const, nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 3,
    correlationId: 'corr-support-email', createdAt: '2026-08-17T15:03:00.000Z', updatedAt: '2026-08-17T15:03:00.000Z',
  };
}

test('Support Agent creates a draft through safe default email.draft', async () => {
  const integrations = new IntegrationRegistry(); integrations.register(new DeterministicDraftEmailIntegration());
  const handlers = new AgentRuntimeHandlerRegistry(); registerSupportEmailCapabilities(handlers, integrations);
  const result = await handlers.require('support_agent', SUPPORT_EMAIL_DRAFT_CAPABILITY).execute(task());
  assert.equal(result.status, 'completed'); assert.equal(result.output.integrationId, 'email.draft'); assert.equal(result.output.mode, 'draft'); assert.equal(result.output.fromIdentity, 'support');
  assert.deepEqual(result.knowledgeReferences, ['atlas://support/client-communication']);
});

test('Support Agent cannot spoof Sales identity', async () => {
  const integrations = new IntegrationRegistry(); integrations.register(new DeterministicDraftEmailIntegration());
  const handlers = new AgentRuntimeHandlerRegistry(); registerSupportEmailCapabilities(handlers, integrations);
  await assert.rejects(() => handlers.require('support_agent', SUPPORT_EMAIL_DRAFT_CAPABILITY).execute(task('sales')), /may not use email identity sales/);
});

test('Support email capability remains create-draft only', () => {
  const integration = new DeterministicDraftEmailIntegration();
  assert.deepEqual(integration.supportedModes, ['draft']); assert.deepEqual(integration.supportedOperations, ['create_draft']);
});
