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
import { OPERATIONS_WORKFLOW_REASONING_CAPABILITY, registerOperationsModelCapabilities } from './operations-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function operationsTask(): AgentRuntimeTask {
  return {
    taskId: 'task-operations-gemini-e2e-1',
    executionId: 'exec-operations-gemini-e2e-1',
    originAgent: 'executive_agent',
    destinationAgent: 'operations_agent',
    objective: 'Analyse a synthetic multi-agent workflow bottleneck',
    priority: 'high',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://operations/synthetic-orchestration-policy'],
    inputs: {
      workflowBrief: 'Analyse the safest coordination sequence for a synthetic client workflow where Sales is complete, Production depends on verified assets, and Finance has not confirmed settlement.',
      workflowContext: 'Synthetic scenario only. Sales handoff is verified. Production assets are incomplete. Finance state is payment initiated, not settled. No approval exists to bypass either gate. Capacity is available for Operations, Production, and Finance.',
    },
    expectedOutput: 'Workflow coordination analysis for governed runtime review',
    dependencies: [],
    risks: [],
    confidence: 0.94,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-operations-gemini-e2e-1',
    createdAt: '2026-08-15T11:09:00.000Z',
    updatedAt: '2026-08-15T11:09:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(task: AgentRuntimeTask) {
    this.execution = { task, version: 1, persistedAt: '2026-08-15T11:09:00.000Z' };
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

test('production runtime executes Operations Agent through governed Gemini draft integration', async () => {
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
          text: 'Recommendation: keep Production blocked on incomplete assets and unsettled payment evidence, request the missing evidence through governed runtime actions, and do not bypass either gate.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 66,
          outputTokens: 32,
        },
        evidenceReferences: ['gemini:operations-e2e:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerOperationsModelCapabilities(handlers, integrations);

  const task = operationsTask();
  const store = new MemoryRuntimeStore(task);
  let eventId = 0;
  let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-15T11:09:0${second++}.000Z`,
    createEventId: () => `operations-gemini-event-${++eventId}`,
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
    capabilityId: OPERATIONS_WORKFLOW_REASONING_CAPABILITY,
  });

  assert.equal(providerCalls, 1);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed');
  assert.equal(outcome.record.result?.agentId, 'operations_agent');
  assert.equal(outcome.record.result?.output.integrationId, 'model.gemini');
  assert.equal(outcome.record.result?.output.provider, 'google-gemini');
  assert.equal(outcome.record.result?.output.mode, 'draft');
  assert.equal(outcome.record.result?.output.integrationStatus, 'drafted');
  assert.equal(outcome.record.result?.output.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(outcome.record.result?.knowledgeReferences, ['atlas://operations/synthetic-orchestration-policy']);

  assert.equal(capturedInput?.prompt, 'Analyse the safest coordination sequence for a synthetic client workflow where Sales is complete, Production depends on verified assets, and Finance has not confirmed settlement.');
  assert.match(capturedInput?.context ?? '', /payment initiated, not settled/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not schedule, dispatch, transition, retry, cancel, escalate, approve, or complete runtime tasks/);
  assert.match(capturedInput?.systemInstruction ?? '', /AxorOS runtime is the sole execution authority/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not override Executive Agent decisions/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not trigger integrations/);

  assert.equal(store.events.length, 2);
  assert.equal(store.events[0]?.fromStatus, 'ready');
  assert.equal(store.events[0]?.toStatus, 'in_progress');
  assert.equal(store.events[1]?.fromStatus, 'in_progress');
  assert.equal(store.events[1]?.toStatus, 'completed');
  assert.equal(store.idempotency.size, 2);

  const replay = await production.execute({
    executionId: task.executionId,
    capabilityId: OPERATIONS_WORKFLOW_REASONING_CAPABILITY,
  });
  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 1);
  assert.equal(store.events.length, 2);
});
