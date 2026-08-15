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
import { SALES_DRAFT_RESPONSE_CAPABILITY, registerSalesModelCapabilities } from './sales-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function salesTask(): AgentRuntimeTask {
  return {
    taskId: 'task-sales-gemini-e2e-1',
    executionId: 'exec-sales-gemini-e2e-1',
    originAgent: 'operations_agent',
    destinationAgent: 'sales_agent',
    objective: 'Draft a synthetic sales response from approved commercial inputs',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://sales/synthetic-commercial-brief'],
    inputs: {
      salesBrief: 'Draft a concise response explaining the approved website package and next review step.',
      salesContext: 'Synthetic prospect. Approved package price: ZAR 8,500. No payment, contract, or production-start evidence is supplied.',
    },
    expectedOutput: 'Draft sales response for internal review',
    dependencies: [],
    risks: [],
    confidence: 0.95,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-sales-gemini-e2e-1',
    createdAt: '2026-08-15T10:52:00.000Z',
    updatedAt: '2026-08-15T10:52:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(task: AgentRuntimeTask) {
    this.execution = { task, version: 1, persistedAt: '2026-08-15T10:52:00.000Z' };
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

test('production runtime executes Sales Agent through governed Gemini draft integration', async () => {
  let providerCalls = 0;
  let capturedInput: ModelGenerationInput | undefined;

  const gemini: ExternalIntegration<ModelGenerationInput, ModelGenerationOutput> = {
    integrationId: 'model.gemini',
    kind: 'model',
    provider: 'google-gemini',
    supportedModes: ['draft'],
    supportedOperations: ['generate_text'],
    async execute(request) {
      providerCalls += 1;
      capturedInput = request.input;
      return {
        integrationId: 'model.gemini',
        operation: request.operation,
        provider: 'google-gemini',
        mode: request.mode,
        status: 'drafted',
        output: {
          text: 'The approved website package is ZAR 8,500. This draft requires review before any external communication.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 52,
          outputTokens: 22,
        },
        evidenceReferences: ['gemini:sales-e2e:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerSalesModelCapabilities(handlers, integrations);

  const task = salesTask();
  const store = new MemoryRuntimeStore(task);
  let eventId = 0;
  let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-15T10:52:0${second++}.000Z`,
    createEventId: () => `sales-gemini-event-${++eventId}`,
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
    capabilityId: SALES_DRAFT_RESPONSE_CAPABILITY,
  });

  assert.equal(providerCalls, 1);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed');
  assert.equal(outcome.record.result?.agentId, 'sales_agent');
  assert.equal(outcome.record.result?.output.integrationId, 'model.gemini');
  assert.equal(outcome.record.result?.output.provider, 'google-gemini');
  assert.equal(outcome.record.result?.output.mode, 'draft');
  assert.equal(outcome.record.result?.output.integrationStatus, 'drafted');
  assert.equal(outcome.record.result?.output.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(outcome.record.result?.knowledgeReferences, ['atlas://sales/synthetic-commercial-brief']);

  assert.equal(capturedInput?.prompt, 'Draft a concise response explaining the approved website package and next review step.');
  assert.match(capturedInput?.context ?? '', /Approved package price: ZAR 8,500/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not invent prices/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not send email/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not claim that a contract is signed/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not authorize discounts/);

  assert.equal(store.events.length, 2);
  assert.equal(store.events[0]?.fromStatus, 'ready');
  assert.equal(store.events[0]?.toStatus, 'in_progress');
  assert.equal(store.events[1]?.fromStatus, 'in_progress');
  assert.equal(store.events[1]?.toStatus, 'completed');
  assert.equal(store.idempotency.size, 2);

  const replay = await production.execute({
    executionId: task.executionId,
    capabilityId: SALES_DRAFT_RESPONSE_CAPABILITY,
  });
  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 1);
  assert.equal(store.events.length, 2);
});
