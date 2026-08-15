import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import { createProductionRuntimeExecutor } from './agent-runtime-production-executor.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { registerSalesEmailCapabilities, SALES_EMAIL_DRAFT_CAPABILITY } from './sales-email-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import type { EmailDraftOutput, EmailMessageInput } from '../integrations/email-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';

function salesEmailTask(): AgentRuntimeTask {
  return {
    taskId: 'task-sales-email-e2e-1',
    executionId: 'exec-sales-email-e2e-1',
    originAgent: 'operations_agent',
    destinationAgent: 'sales_agent',
    objective: 'Create a governed synthetic sales email draft',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://sales/synthetic-outreach-policy'],
    inputs: {
      fromIdentity: 'sales',
      to: [{ email: 'prospect@example.test', name: 'Synthetic Prospect' }],
      subject: 'Synthetic website discussion',
      textBody: 'This is a synthetic internal sales email draft and must not be sent.',
    },
    expectedOutput: 'Internal email draft only',
    dependencies: [],
    risks: [],
    confidence: 0.95,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-sales-email-e2e-1',
    createdAt: '2026-08-15T11:35:00.000Z',
    updatedAt: '2026-08-15T11:35:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(task: AgentRuntimeTask) {
    this.execution = { task, version: 1, persistedAt: '2026-08-15T11:35:00.000Z' };
  }

  async getExecution(executionId: string): Promise<AgentRuntimeExecutionRecord | null> {
    return this.execution.task.executionId === executionId ? this.execution : null;
  }

  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number): Promise<void> {
    if (this.execution.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId);
    this.execution = record;
  }

  async appendEvent(event: AgentRuntimeEvent): Promise<void> {
    this.events.push(event);
  }

  async listEvents(executionId: string): Promise<readonly AgentRuntimeEvent[]> {
    return this.events.filter((event) => event.executionId === executionId);
  }

  async hasIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    return this.idempotency.has(idempotencyKey);
  }

  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord): Promise<void> {
    this.idempotency.set(record.idempotencyKey, record);
  }
}

test('production runtime executes Sales Agent through governed draft-only email integration', async () => {
  let providerCalls = 0;
  let capturedInput: EmailMessageInput | undefined;

  const email: ExternalIntegration<EmailMessageInput, EmailDraftOutput> = {
    integrationId: 'email.draft',
    kind: 'email',
    provider: 'deterministic-draft-email',
    supportedModes: ['draft'],
    supportedOperations: ['create_draft'],
    async execute(request) {
      providerCalls += 1;
      capturedInput = request.input;
      return {
        integrationId: 'email.draft',
        operation: request.operation,
        provider: 'deterministic-draft-email',
        mode: request.mode,
        status: 'drafted',
        output: {
          draftId: 'draft:synthetic-sales-email-1',
          fromIdentity: request.input.fromIdentity,
          recipients: request.input.to.map((recipient) => recipient.email),
          subject: request.input.subject,
          preview: request.input.textBody.slice(0, 160),
        },
        evidenceReferences: ['email-draft:synthetic-sales-email-1'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(email);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerSalesEmailCapabilities(handlers, integrations);

  const task = salesEmailTask();
  const store = new MemoryRuntimeStore(task);
  let eventId = 0;
  let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-15T11:35:0${second++}.000Z`,
    createEventId: () => `sales-email-event-${++eventId}`,
  });

  const production = createProductionRuntimeExecutor({
    orchestrator,
    schedulingSource: {
      async listSchedulingTasks() {
        return [store.execution.task];
      },
      async getAgentCapacity(agentId) {
        return { agentId, state: 'available', activeTasks: 0, maxConcurrentTasks: 2 };
      },
    },
  });

  const outcome = await production.execute({
    executionId: task.executionId,
    capabilityId: SALES_EMAIL_DRAFT_CAPABILITY,
  });

  assert.equal(providerCalls, 1);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed');
  assert.equal(outcome.record.result?.agentId, 'sales_agent');
  assert.equal(outcome.record.result?.output.integrationId, 'email.draft');
  assert.equal(outcome.record.result?.output.provider, 'deterministic-draft-email');
  assert.equal(outcome.record.result?.output.mode, 'draft');
  assert.equal(outcome.record.result?.output.integrationStatus, 'drafted');
  assert.equal(outcome.record.result?.output.draftId, 'draft:synthetic-sales-email-1');
  assert.deepEqual(outcome.record.result?.knowledgeReferences, ['atlas://sales/synthetic-outreach-policy']);

  assert.equal(capturedInput?.fromIdentity, 'sales');
  assert.equal(capturedInput?.to[0]?.email, 'prospect@example.test');
  assert.equal(capturedInput?.subject, 'Synthetic website discussion');
  assert.match(capturedInput?.textBody ?? '', /must not be sent/);

  assert.equal(store.events.length, 2);
  assert.equal(store.events[0]?.fromStatus, 'ready');
  assert.equal(store.events[0]?.toStatus, 'in_progress');
  assert.equal(store.events[1]?.fromStatus, 'in_progress');
  assert.equal(store.events[1]?.toStatus, 'completed');
  assert.equal(store.idempotency.size, 2);

  const replay = await production.execute({
    executionId: task.executionId,
    capabilityId: SALES_EMAIL_DRAFT_CAPABILITY,
  });

  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 1);
  assert.equal(store.events.length, 2);
});
