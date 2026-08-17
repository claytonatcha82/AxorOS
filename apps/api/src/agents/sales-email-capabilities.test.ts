import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { registerSalesEmailCapabilities, SALES_EMAIL_DRAFT_CAPABILITY } from './sales-email-capabilities.js';
import { DeterministicDraftEmailIntegration } from '../integrations/deterministic-draft-email-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';

function task() {
  return {
    taskId: 'task-sales-email-1', executionId: 'exec-sales-email-1', originAgent: 'operations_agent' as const, destinationAgent: 'sales_agent' as const,
    objective: 'Create a governed synthetic sales email draft', priority: 'normal' as const, context: { testOnly: true },
    knowledgeReferences: ['atlas://sales/synthetic-approved-context'],
    inputs: { fromIdentity: 'sales', to: [{ email: 'prospect@example.test', name: 'Synthetic Prospect' }], subject: 'Synthetic website discussion', textBody: 'This is approved synthetic draft content for testing only.' },
    expectedOutput: 'Internal email draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'in_progress' as const,
    nextAction: 'execute_destination_capability', attempt: 1, maxAttempts: 3, correlationId: 'corr-sales-email-1', createdAt: '2026-08-15T11:30:00.000Z', updatedAt: '2026-08-15T11:30:00.000Z',
  };
}

test('Sales Agent creates a draft through email.draft and preserves knowledge references', async () => {
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicDraftEmailIntegration());
  const handlers = new AgentRuntimeHandlerRegistry();
  registerSalesEmailCapabilities(handlers, integrations);
  const result = await handlers.require('sales_agent', SALES_EMAIL_DRAFT_CAPABILITY).execute(task());
  assert.equal(result.status, 'completed');
  assert.equal(result.output.integrationId, 'email.draft');
  assert.equal(result.output.mode, 'draft');
  assert.equal(result.output.integrationStatus, 'drafted');
  assert.equal(result.output.fromIdentity, 'sales');
  assert.deepEqual(result.output.recipients, ['prospect@example.test']);
  assert.deepEqual(result.knowledgeReferences, ['atlas://sales/synthetic-approved-context']);
});

test('Sales email capability may select Gmail without gaining send or live authority', async () => {
  const integrations = new IntegrationRegistry();
  let observedRequest: Record<string, unknown> | undefined;
  integrations.register({
    integrationId: 'email.gmail', kind: 'email', provider: 'google-gmail-test', supportedModes: ['draft'], supportedOperations: ['create_draft'],
    async execute(request) { observedRequest = request as unknown as Record<string, unknown>; return { integrationId: 'email.gmail', operation: request.operation, provider: 'google-gmail-test', mode: request.mode, status: 'drafted', output: { draftId: 'gmail-draft-test', fromIdentity: 'sales', recipients: ['prospect@example.test'], subject: 'Synthetic website discussion', preview: 'Synthetic' }, evidenceReferences: ['gmail:draft:gmail-draft-test'], retryable: false }; },
  });
  const handlers = new AgentRuntimeHandlerRegistry();
  registerSalesEmailCapabilities(handlers, integrations, { integrationId: 'email.gmail' });
  const result = await handlers.require('sales_agent', SALES_EMAIL_DRAFT_CAPABILITY).execute(task());
  assert.equal(result.output.integrationId, 'email.gmail');
  assert.equal(observedRequest?.operation, 'create_draft');
  assert.equal(observedRequest?.mode, 'draft');
  assert.equal(observedRequest?.requestedBy, 'sales_agent');
});

test('Sales email capability has no send operation or live mode authority', () => {
  const integration = new DeterministicDraftEmailIntegration();
  assert.deepEqual(integration.supportedModes, ['draft']);
  assert.deepEqual(integration.supportedOperations, ['create_draft']);
});
