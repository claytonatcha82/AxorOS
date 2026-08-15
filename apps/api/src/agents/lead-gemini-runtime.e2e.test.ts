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
import { LEAD_RESEARCH_QUALIFICATION_CAPABILITY, registerLeadModelCapabilities } from './lead-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function leadTask(): AgentRuntimeTask {
  return {
    taskId: 'task-lead-gemini-e2e-1',
    executionId: 'exec-lead-gemini-e2e-1',
    originAgent: 'operations_agent',
    destinationAgent: 'lead_agent',
    objective: 'Research and qualify a synthetic lead',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic' },
    knowledgeReferences: ['atlas://lead/synthetic-qualification-policy'],
    inputs: {
      researchBrief: 'Assess whether Example Engineering is a plausible web-agency lead from the supplied facts.',
      leadContext: 'Synthetic company only. Public facts supplied: engineering business, outdated brochure-style website, no online enquiry form. Budget and decision-maker are unknown.',
    },
    expectedOutput: 'Internal research and qualification assessment',
    dependencies: [],
    risks: [],
    confidence: 0.9,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-lead-gemini-e2e-1',
    createdAt: '2026-08-15T10:22:00.000Z',
    updatedAt: '2026-08-15T10:22:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(task: AgentRuntimeTask) {
    this.execution = {
      task,
      version: 1,
      persistedAt: '2026-08-15T10:22:00.000Z',
    };
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

test('production runtime executes Lead Agent through governed Gemini draft integration', async () => {
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
          text: 'Potential fit: outdated website and missing enquiry flow are relevant signals. Qualification remains incomplete because budget, urgency, and decision-maker are unknown.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 64,
          outputTokens: 28,
        },
        evidenceReferences: ['gemini:e2e:lead:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerLeadModelCapabilities(handlers, integrations);

  const task = leadTask();
  const store = new MemoryRuntimeStore(task);
  let eventId = 0;
  let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-15T10:22:0${second++}.000Z`,
    createEventId: () => `lead-gemini-event-${++eventId}`,
  });

  const production = createProductionRuntimeExecutor({
    orchestrator,
    schedulingSource: {
      async listSchedulingTasks() {
        return [store.execution.task];
      },
      async getAgentCapacity(agentId) {
        return {
          agentId,
          state: 'available',
          activeTasks: 0,
          maxConcurrentTasks: 2,
        };
      },
    },
  });

  const outcome = await production.execute({
    executionId: task.executionId,
    capabilityId: LEAD_RESEARCH_QUALIFICATION_CAPABILITY,
  });

  assert.equal(providerCalls, 1);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed');
  assert.equal(outcome.record.result?.agentId, 'lead_agent');
  assert.equal(outcome.record.result?.output.integrationId, 'model.gemini');
  assert.equal(outcome.record.result?.output.provider, 'google-gemini');
  assert.equal(outcome.record.result?.output.mode, 'draft');
  assert.equal(outcome.record.result?.output.integrationStatus, 'drafted');
  assert.equal(outcome.record.result?.output.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(outcome.record.result?.knowledgeReferences, ['atlas://lead/synthetic-qualification-policy']);

  assert.equal(capturedInput?.prompt, 'Assess whether Example Engineering is a plausible web-agency lead from the supplied facts.');
  assert.equal(capturedInput?.context, 'Synthetic company only. Public facts supplied: engineering business, outdated brochure-style website, no online enquiry form. Budget and decision-maker are unknown.');
  assert.match(capturedInput?.systemInstruction ?? '', /Do not write or send outreach/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not claim a lead is qualified without evidence/);

  assert.equal(store.events.length, 2);
  assert.equal(store.events[0]?.fromStatus, 'ready');
  assert.equal(store.events[0]?.toStatus, 'in_progress');
  assert.equal(store.events[1]?.fromStatus, 'in_progress');
  assert.equal(store.events[1]?.toStatus, 'completed');
  assert.equal(store.idempotency.size, 2);

  const replay = await production.execute({
    executionId: task.executionId,
    capabilityId: LEAD_RESEARCH_QUALIFICATION_CAPABILITY,
  });
  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 1);
  assert.equal(store.events.length, 2);
});
