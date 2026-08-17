import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { createOperationsEmailDraftHandler, OPERATIONS_EMAIL_DRAFT_CAPABILITY } from './operations-email-capabilities.js';
import type { EmailDraftOutput, EmailMessageInput } from '../integrations/email-integration.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  return {
    taskId: 'task-operations-email', executionId: 'exec-operations-email', originAgent: 'executive_agent', destinationAgent: 'operations_agent',
    objective: 'Create synthetic Operations status draft', priority: 'normal', context: { testOnly: true }, knowledgeReferences: ['atlas://operations/communication-governance'],
    inputs: { fromIdentity: 'operations', to: [{ email: 'client@example.test' }], subject: 'Project status', textBody: 'Synthetic operational status update.' },
    expectedOutput: 'Operations email draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'execute_destination_capability',
    attempt: 1, maxAttempts: 2, correlationId: 'corr-operations-email', createdAt: '2026-08-17T20:45:00.000Z', updatedAt: '2026-08-17T20:45:00.000Z', ...overrides,
  };
}

function harness() {
  let captured: unknown;
  const integration: ExternalIntegration<EmailMessageInput, EmailDraftOutput> = {
    integrationId: 'email.draft', kind: 'email', provider: 'operations-test-draft', supportedModes: ['draft'], supportedOperations: ['create_draft'],
    async execute(request) {
      captured = request;
      return { integrationId: 'email.draft', operation: request.operation, provider: 'operations-test-draft', mode: request.mode, status: 'drafted', output: { draftId: 'draft-operations-1', fromIdentity: request.input.fromIdentity, recipients: request.input.to.map((recipient) => recipient.email), subject: request.input.subject, preview: request.input.textBody }, evidenceReferences: ['draft:operations-1'], retryable: false };
    },
  };
  const integrations = new IntegrationRegistry(); integrations.register(integration);
  return { handler: createOperationsEmailDraftHandler(integrations), captured: () => captured };
}

test('Operations creates a deterministic draft with its governed identity and preserves knowledge references', async () => {
  const { handler, captured } = harness();
  assert.equal(handler.agentId, 'operations_agent'); assert.equal(handler.capabilityId, OPERATIONS_EMAIL_DRAFT_CAPABILITY);
  const result = await handler.execute(task());
  assert.equal(result.status, 'completed'); assert.equal(result.output.draftId, 'draft-operations-1'); assert.deepEqual(result.knowledgeReferences, ['atlas://operations/communication-governance']);
  const request = captured() as { requestedBy: string; operation: string; mode: string; idempotencyKey: string; input: EmailMessageInput };
  assert.equal(request.requestedBy, 'operations_agent'); assert.equal(request.operation, 'create_draft'); assert.equal(request.mode, 'draft'); assert.equal(request.input.fromIdentity, 'operations');
  assert.equal(request.idempotencyKey, 'operations-email-draft:exec-operations-email:1');
});

test('Operations cannot spoof the Sales email identity', async () => {
  const { handler } = harness();
  await assert.rejects(() => handler.execute(task({ inputs: { fromIdentity: 'sales', to: [{ email: 'client@example.test' }], subject: 'Status', textBody: 'Synthetic.' } })), /may not use email identity sales/);
});

test('Operations email capability rejects the wrong destination agent', async () => {
  const { handler } = harness();
  await assert.rejects(() => handler.execute(task({ destinationAgent: 'sales_agent' })), /requires destinationAgent operations_agent/);
});
