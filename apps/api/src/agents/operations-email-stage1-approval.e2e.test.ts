import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { applyOperationsEmailRuntimeApprovalPolicy } from './operations-email-runtime-approval.js';
import { registerOperationsEmailCapabilities, OPERATIONS_EMAIL_DRAFT_CAPABILITY } from './operations-email-capabilities.js';
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

function externalOperationsTask(): AgentRuntimeTask {
  return {
    taskId: 'task-stage1-operations-email', executionId: 'exec-stage1-operations-email', originAgent: 'executive_agent', destinationAgent: 'operations_agent',
    objective: 'Create governed external Operations communication draft', priority: 'normal', context: { environment: 'pilot', dataClass: 'synthetic-external-simulation' },
    knowledgeReferences: ['atlas://operations/communication-governance'], inputs: { fromIdentity: 'operations', to: [{ email: 'client@example.test' }], subject: 'Project coordination update', textBody: 'Synthetic Stage 1 Operations approval lifecycle content. No unsupported completion, deadline, financial, contractual, or deployment claims.' },
    expectedOutput: 'Human-approved Operations draft', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false, status: 'ready', nextAction: 'apply_operations_email_policy',
    attempt: 1, maxAttempts: 3, correlationId: 'corr-stage1-operations-email', createdAt: '2026-08-17T20:52:00.000Z', updatedAt: '2026-08-17T20:52:00.000Z',
  };
}

function createHarness() {
  let providerCalls = 0;
  const email: ExternalIntegration<EmailMessageInput, EmailDraftOutput> = {
    integrationId: 'email.draft', kind: 'email', provider: 'operations-stage1-test-draft', supportedModes: ['draft'], supportedOperations: ['create_draft'],
    async execute(request) { providerCalls += 1; return { integrationId: 'email.draft', operation: request.operation, provider: 'operations-stage1-test-draft', mode: request.mode, status: 'drafted', output: { draftId: 'draft-operations-stage1-approved', fromIdentity: request.input.fromIdentity, recipients: request.input.to.map((r) => r.email), subject: request.input.subject, preview: request.input.textBody }, evidenceReferences: ['draft:operations-stage1-approved'], retryable: false }; },
  };
  const integrations = new IntegrationRegistry(); integrations.register(email);
  const handlers = new AgentRuntimeHandlerRegistry(); registerOperationsEmailCapabilities(handlers, integrations);
  const prepared = applyOperationsEmailRuntimeApprovalPolicy(externalOperationsTask());
  const store = new MemoryRuntimeStore(prepared);
  let eventId = 0;
  const orchestrator = createAgentRuntimeOrchestrator({ store, handlers, createEventId: () => `operations-stage1-event-${++eventId}`, now: () => new Date(1786999920000 + eventId * 1000).toISOString() });
  return { prepared, store, orchestrator, providerCalls: () => providerCalls };
}

test('Operations Stage 1 waits for Human Executive approval before draft provider execution, then resumes', async () => {
  const { prepared, store, orchestrator, providerCalls } = createHarness();
  const review = await orchestrator.execute({ executionId: prepared.executionId, capabilityId: OPERATIONS_EMAIL_DRAFT_CAPABILITY });
  assert.equal(review.record.task.status, 'review'); assert.equal(review.record.task.approvalOwner, 'human_executive'); assert.equal(providerCalls(), 0);
  const approved = await orchestrator.resolveApproval({ executionId: prepared.executionId, actor: 'human_executive', decision: 'approved', reason: 'Stage 1 Operations communication approved for draft creation' });
  assert.equal(approved.record.task.status, 'ready'); assert.equal(approved.record.task.approvalRequired, false); assert.equal(providerCalls(), 0);
  const completed = await orchestrator.execute({ executionId: prepared.executionId, capabilityId: OPERATIONS_EMAIL_DRAFT_CAPABILITY });
  assert.equal(completed.record.task.status, 'completed'); assert.equal(completed.record.result?.output.draftId, 'draft-operations-stage1-approved'); assert.equal(providerCalls(), 1);
  assert.ok(store.events.some((event) => event.type === 'approval_requested')); assert.ok(store.events.some((event) => event.type === 'approval_granted'));
});

test('Operations Stage 1 rejects the wrong approver without executing the provider', async () => {
  const { prepared, store, orchestrator, providerCalls } = createHarness();
  await orchestrator.execute({ executionId: prepared.executionId, capabilityId: OPERATIONS_EMAIL_DRAFT_CAPABILITY });
  await assert.rejects(() => orchestrator.resolveApproval({ executionId: prepared.executionId, actor: 'executive_agent', decision: 'approved' }), /must be resolved by human_executive/);
  assert.equal(providerCalls(), 0); assert.equal(store.execution.task.status, 'review'); assert.equal(store.execution.task.approvalRequired, true);
});

test('Operations Stage 1 replay after completion is idempotent and does not create a second draft', async () => {
  const { prepared, orchestrator, providerCalls } = createHarness();
  await orchestrator.execute({ executionId: prepared.executionId, capabilityId: OPERATIONS_EMAIL_DRAFT_CAPABILITY });
  await orchestrator.resolveApproval({ executionId: prepared.executionId, actor: 'human_executive', decision: 'approved' });
  const completed = await orchestrator.execute({ executionId: prepared.executionId, capabilityId: OPERATIONS_EMAIL_DRAFT_CAPABILITY });
  assert.equal(completed.record.task.status, 'completed'); assert.equal(providerCalls(), 1);
  const replay = await orchestrator.execute({ executionId: prepared.executionId, capabilityId: OPERATIONS_EMAIL_DRAFT_CAPABILITY });
  assert.equal(replay.replayed, true); assert.equal(replay.record.task.status, 'completed'); assert.equal(providerCalls(), 1);
});
