import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';
import type { AgentRuntimeEvent, AgentRuntimeExecutionRecord } from './agent-runtime-state.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { registerModelRuntimeCapability } from './model-runtime-registration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createSandboxModelIntegration } from '../integrations/sandbox-model-integration.js';

function modelRecord(): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'task-model-1',
      executionId: 'exec-model-1',
      originAgent: 'operations_agent',
      destinationAgent: 'marketing_agent',
      objective: 'Draft homepage marketing copy',
      priority: 'normal',
      context: {},
      knowledgeReferences: ['knowledge-homepage-brief'],
      inputs: {
        brief: 'Create a premium homepage headline for a web agency.',
        context: 'Audience: South African SMEs. Tone: concise and credible.',
      },
      expectedOutput: 'Draft homepage headline',
      dependencies: [],
      risks: [],
      confidence: 0.9,
      approvalRequired: false,
      status: 'ready',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 3,
      correlationId: 'corr-model-1',
      createdAt: '2026-08-15T09:00:00.000Z',
      updatedAt: '2026-08-15T09:00:00.000Z',
    },
    version: 1,
    persistedAt: '2026-08-15T09:00:00.000Z',
  };
}

class MemoryRuntimeStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord | null;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(record: AgentRuntimeExecutionRecord) {
    this.execution = record;
  }

  async getExecution(executionId: string): Promise<AgentRuntimeExecutionRecord | null> {
    return this.execution?.task.executionId === executionId ? this.execution : null;
  }

  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number): Promise<void> {
    if (!this.execution || this.execution.version !== expectedVersion) {
      throw new RuntimeVersionConflictError(record.task.executionId);
    }
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

test('runtime orchestrator executes a governed sandbox model capability end to end', async () => {
  const integrations = new IntegrationRegistry();
  integrations.register(createSandboxModelIntegration());

  const handlers = new AgentRuntimeHandlerRegistry();
  registerModelRuntimeCapability(handlers, integrations, {
    agentId: 'marketing_agent',
    capabilityId: 'draft_marketing_copy',
    integrationId: 'model.sandbox',
    mode: 'sandbox',
    promptInputKey: 'brief',
    contextInputKey: 'context',
    systemInstruction: 'Write concise, credible web-agency marketing copy.',
  });

  const store = new MemoryRuntimeStore(modelRecord());
  let eventId = 0;
  let second = 0;
  const orchestrator = createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-15T09:00:0${second++}.000Z`,
    createEventId: () => `model-event-${++eventId}`,
  });

  const outcome = await orchestrator.execute({
    executionId: 'exec-model-1',
    capabilityId: 'draft_marketing_copy',
  });

  assert.equal(outcome.replayed, false);
  assert.equal(outcome.record.task.status, 'completed');
  assert.equal(outcome.record.result?.status, 'completed');
  assert.equal(outcome.record.result?.agentId, 'marketing_agent');
  assert.equal(outcome.record.result?.output.integrationId, 'model.sandbox');
  assert.equal(outcome.record.result?.output.provider, 'axoros-sandbox');
  assert.equal(outcome.record.result?.output.mode, 'sandbox');
  assert.match(String(outcome.record.result?.output.text), /premium homepage headline/i);
  assert.deepEqual(outcome.record.result?.knowledgeReferences, ['knowledge-homepage-brief']);

  assert.equal(store.execution?.task.status, 'completed');
  assert.equal(store.execution?.result?.output.integrationId, 'model.sandbox');
  assert.equal(store.events.length, 2);
  assert.equal(store.events[0]?.fromStatus, 'ready');
  assert.equal(store.events[0]?.toStatus, 'in_progress');
  assert.equal(store.events[1]?.fromStatus, 'in_progress');
  assert.equal(store.events[1]?.toStatus, 'completed');
  assert.equal(store.idempotency.size, 2);

  const replay = await orchestrator.execute({
    executionId: 'exec-model-1',
    capabilityId: 'draft_marketing_copy',
  });
  assert.equal(replay.replayed, true);
  assert.equal(store.events.length, 2);
});
