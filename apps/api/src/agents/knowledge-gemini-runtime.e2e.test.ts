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
import { KNOWLEDGE_SYNTHESIS_CAPABILITY, registerKnowledgeModelCapabilities } from './knowledge-model-capabilities.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { ModelGenerationInput, ModelGenerationOutput } from '../integrations/model-integration.js';

function knowledgeTask(): AgentRuntimeTask {
  return {
    taskId: 'task-knowledge-gemini-e2e-1',
    executionId: 'exec-knowledge-gemini-e2e-1',
    originAgent: 'operations_agent',
    destinationAgent: 'knowledge_agent',
    objective: 'Synthesize synthetic Atlas retrieval context without replacing retrieval authority',
    priority: 'normal',
    context: { environment: 'test', dataClass: 'synthetic', securityCeiling: 'internal' },
    knowledgeReferences: ['atlas://governance/synthetic-rule', 'atlas://sop/synthetic-procedure'],
    inputs: {
      knowledgeQuestion: 'What is the authoritative synthetic rule and what conflict should be reported?',
      retrievedContext: '[S1] Title: Synthetic Governance Rule\nPath: Atlas/Governance/Synthetic.md\nHeading: Rule\nVersion: 2\nAuthority: Governance\nContent: Human approval is required for the synthetic action.\n\n[S2] Title: Synthetic Procedure\nPath: Atlas/SOPs/Synthetic.md\nHeading: Procedure\nVersion: 1\nAuthority: SOP\nContent: The synthetic action may proceed automatically.\n',
    },
    expectedOutput: 'Citation-ready synthesis with conflict disclosure',
    dependencies: [],
    risks: [],
    confidence: 0.95,
    approvalRequired: false,
    status: 'ready',
    nextAction: 'execute_destination_capability',
    attempt: 1,
    maxAttempts: 3,
    correlationId: 'corr-knowledge-gemini-e2e-1',
    createdAt: '2026-08-15T11:23:00.000Z',
    updatedAt: '2026-08-15T11:23:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(task: AgentRuntimeTask) {
    this.execution = { task, version: 1, persistedAt: '2026-08-15T11:23:00.000Z' };
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

test('production runtime executes Knowledge Agent through governed Gemini draft integration', async () => {
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
          text: 'The supplied Governance source requires Human approval [S1]. This conflicts with the lower-authority SOP source that permits automatic execution [S2]. On supplied metadata, [S1] governs; the conflict should be reported rather than silently reconciled.',
          model: 'gemini-3.5-flash-lite',
          finishReason: 'stop',
          inputTokens: 104,
          outputTokens: 49,
        },
        evidenceReferences: ['gemini:knowledge-e2e:synthetic'],
        retryable: false,
      };
    },
  };

  const integrations = new IntegrationRegistry();
  integrations.register(gemini);

  const handlers = new AgentRuntimeHandlerRegistry();
  registerKnowledgeModelCapabilities(handlers, integrations);

  const task = knowledgeTask();
  const store = new MemoryRuntimeStore(task);
  let eventId = 0;
  let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-15T11:23:0${second++}.000Z`,
    createEventId: () => `knowledge-gemini-event-${++eventId}`,
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
    capabilityId: KNOWLEDGE_SYNTHESIS_CAPABILITY,
  });

  assert.equal(providerCalls, 1);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed');
  assert.equal(outcome.record.result?.agentId, 'knowledge_agent');
  assert.equal(outcome.record.result?.output.integrationId, 'model.gemini');
  assert.equal(outcome.record.result?.output.provider, 'google-gemini');
  assert.equal(outcome.record.result?.output.mode, 'draft');
  assert.equal(outcome.record.result?.output.integrationStatus, 'drafted');
  assert.equal(outcome.record.result?.output.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(outcome.record.result?.knowledgeReferences, [
    'atlas://governance/synthetic-rule',
    'atlas://sop/synthetic-procedure',
  ]);

  assert.match(capturedInput?.context ?? '', /\[S1\]/);
  assert.match(capturedInput?.context ?? '', /\[S2\]/);
  assert.match(capturedInput?.systemInstruction ?? '', /deterministic retrieval remains authoritative/);
  assert.match(capturedInput?.systemInstruction ?? '', /Preserve source references/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not invent sources, citations/);
  assert.match(capturedInput?.systemInstruction ?? '', /Governance over Standards over SOPs/);
  assert.match(capturedInput?.systemInstruction ?? '', /Respect the supplied security ceiling/);
  assert.match(capturedInput?.systemInstruction ?? '', /Do not replace retrieval with model memory/);

  assert.equal(store.events.length, 2);
  assert.equal(store.events[0]?.fromStatus, 'ready');
  assert.equal(store.events[0]?.toStatus, 'in_progress');
  assert.equal(store.events[1]?.fromStatus, 'in_progress');
  assert.equal(store.events[1]?.toStatus, 'completed');
  assert.equal(store.idempotency.size, 2);

  const replay = await production.execute({
    executionId: task.executionId,
    capabilityId: KNOWLEDGE_SYNTHESIS_CAPABILITY,
  });
  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 1);
  assert.equal(store.events.length, 2);
});
