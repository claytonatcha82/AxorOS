import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { applySupportEmailRuntimeApprovalPolicy } from './support-email-runtime-approval.js';
import { registerSupportEmailCapabilities, SUPPORT_EMAIL_DRAFT_CAPABILITY } from './support-email-capabilities.js';
import type { EmailDraftOutput, EmailMessageInput } from '../integrations/email-integration.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();
  constructor(task: AgentRuntimeTask) { this.execution = { task, version: 1, persistedAt: task.createdAt }; }
  async getExecution(executionId: string) { return this.execution.task.executionId === executionId ? this.execution : null; }
  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number) { if (this.execution.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId); this.execution = record; }
  async appendEvent(event: AgentRuntimeEvent) { this.events.push(event); }
  async listEvents(executionId: string) { return this.events.filter((event) => event.executionId === executionId); }
  async hasIdempotencyKey(key: string) { return this.idempotency.has(key); }
  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord) { this.idempotency.set(record.idempotencyKey, record); }
}

function externalSupportTask(): AgentRuntimeTask {
  return {
    taskId: 'task-stage1-support-email', executionId: 'exec-stage1-support-email', originAgent: 'operations_agent', destinationAgent: 'support_agent',
    objective: 'Create governed external client Support response draft', priority: 'normal', context: { environment: 'pilot', dataClass: 'synthetic-external-simulation' },
    knowledgeReferences: ['atlas://support/client-communication'], inputs: { fromIdentity: 'support', to: [{ email: 'client@example.test' }], subject: 'Support update', textBody: 'Synthetic Stage 1 Support approval lifecycle content.' },
    expectedOutput: 'Human-approved Support draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'apply_support_email_policy',
    attempt: 1, maxAttempts: 3, correlationId: 'corr-stage1-support-email', createdAt: '2026-08-17T15:08:00.000Z', updatedAt: '2026-08-17T15:08:00.000Z',
  };
}

test('Support Stage 1 waits for Human Executive approval before draft provider execution, then resumes', async () => {
  let providerCalls = 0;
  const email: ExternalIntegration<EmailMessageInput, EmailDraftOutput> = {
    integrationId: 'email.draft', kind: 'email', provider: 'support-stage1-test-draft', supportedModes: ['draft'], supportedOperations: ['create_draft'],
    async execute(request) { providerCalls += 1; return { integrationId: 'email.draft', operation: request.operation, provider: 'support-stage1-test-draft', mode: request.mode, status: 'drafted', output: { draftId: 'draft-support-stage1-approved', fromIdentity: request.input.fromIdentity, recipients: request.input.to.map((r) => r.email), subject: request.input.subject, preview: request.input.textBody }, evidenceReferences: ['draft:support-stage1-approved'], retryable: false }; },
  };
  const integrations = new IntegrationRegistry(); integrations.register(email);
  const handlers = new AgentRuntimeHandlerRegistry(); registerSupportEmailCapabilities(handlers, integrations);
  const prepared = applySupportEmailRuntimeApprovalPolicy(externalSupportTask());
  const store = new MemoryRuntimeStore(prepared);
  let eventId = 0;
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers, createEventId: () => `support-stage1-event-${++eventId}`, now: () => new Date(1786979280000 + eventId * 1000).toISOString() });

  const review = await orchestrator.execute({ executionId: prepared.executionId, capabilityId: SUPPORT_EMAIL_DRAFT_CAPABILITY });
  assert.equal(review.record.task.status, 'review'); assert.equal(review.record.task.approvalOwner, 'human_executive'); assert.equal(providerCalls, 0);

  const approved = await orchestrator.resolveApproval({ executionId: prepared.executionId, actor: 'human_executive', decision: 'approved', reason: 'Stage 1 Support response approved for draft creation' });
  assert.equal(approved.record.task.status, 'ready'); assert.equal(approved.record.task.approvalRequired, false); assert.equal(providerCalls, 0);

  const completed = await orchestrator.execute({ executionId: prepared.executionId, capabilityId: SUPPORT_EMAIL_DRAFT_CAPABILITY });
  assert.equal(completed.record.task.status, 'completed'); assert.equal(completed.record.result?.output.draftId, 'draft-support-stage1-approved'); assert.equal(providerCalls, 1);
  assert.ok(store.events.some((event) => event.type === 'approval_requested')); assert.ok(store.events.some((event) => event.type === 'approval_granted'));
});
