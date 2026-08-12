import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';
import { AgentRuntimeHandlerRegistry } from './agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from './agent-runtime-orchestrator.js';

function sampleRecord(): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'task-conflict',
      executionId: 'exec-conflict',
      originAgent: 'operations_agent',
      destinationAgent: 'sales_agent',
      objective: 'Convert qualified opportunity',
      priority: 'high',
      context: {},
      knowledgeReferences: [],
      inputs: {},
      expectedOutput: 'Commercial decision',
      dependencies: [],
      risks: [],
      confidence: 0.9,
      approvalRequired: false,
      status: 'ready',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 3,
      correlationId: 'corr-conflict',
      createdAt: '2026-08-12T18:00:00.000Z',
      updatedAt: '2026-08-12T18:00:00.000Z',
    },
    version: 1,
    persistedAt: '2026-08-12T18:00:00.000Z',
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
    if (!this.execution || this.execution.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId);
    this.execution = record;
  }

  async appendEvent(event: AgentRuntimeEvent): Promise<void> { this.events.push(event); }
  async listEvents(executionId: string): Promise<readonly AgentRuntimeEvent[]> { return this.events.filter((event) => event.executionId === executionId); }
  async hasIdempotencyKey(idempotencyKey: string): Promise<boolean> { return this.idempotency.has(idempotencyKey); }
  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord): Promise<void> { this.idempotency.set(record.idempotencyKey, record); }
}

function orchestrator(store: MemoryRuntimeStore, handlers: AgentRuntimeHandlerRegistry) {
  let event = 0;
  let second = 0;
  return createAgentRuntimeOrchestrator({
    store,
    handlers,
    now: () => `2026-08-12T18:00:${String(second++).padStart(2, '0')}.000Z`,
    createEventId: () => `event-${++event}`,
  });
}

function conflict(impact: 'medium' | 'high' | 'critical') {
  return {
    conflictId: `conflict-${impact}`,
    agents: ['sales_agent', 'finance_agent'] as ('sales_agent' | 'finance_agent')[],
    description: 'Sales conversion conflicts with financial control.',
    businessImpact: impact,
    evidenceReferences: ['evidence-1'],
    recommendedResolution: 'Resolve commercial and finance constraints.',
    escalationRequired: impact === 'high' || impact === 'critical',
  };
}

test('high objective conflict moves execution to Executive review before handler invocation', async () => {
  const store = new MemoryRuntimeStore(sampleRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  let invoked = false;
  handlers.register({
    agentId: 'sales_agent',
    capabilityId: 'close_opportunity',
    async execute() {
      invoked = true;
      throw new Error('must not execute');
    },
  });

  const outcome = await orchestrator(store, handlers).execute({
    executionId: 'exec-conflict',
    capabilityId: 'close_opportunity',
    objectiveConflict: conflict('high'),
  });

  assert.equal(invoked, false);
  assert.equal(outcome.record.task.status, 'review');
  assert.equal(outcome.record.task.approvalRequired, true);
  assert.equal(outcome.record.task.approvalOwner, 'executive_agent');
  assert.equal(outcome.record.task.nextAction, 'resolve_objective_conflict');
});

test('critical objective conflict escalates to Human Executive before handler invocation', async () => {
  const store = new MemoryRuntimeStore(sampleRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  let invoked = false;
  handlers.register({
    agentId: 'sales_agent',
    capabilityId: 'close_opportunity',
    async execute() {
      invoked = true;
      throw new Error('must not execute');
    },
  });

  const outcome = await orchestrator(store, handlers).execute({
    executionId: 'exec-conflict',
    capabilityId: 'close_opportunity',
    objectiveConflict: conflict('critical'),
  });

  assert.equal(invoked, false);
  assert.equal(outcome.record.task.status, 'escalated');
  assert.equal(outcome.record.task.nextAction, 'human_executive_resolve_objective_conflict');
});

test('medium objective conflict remains within Operations authority and allows execution', async () => {
  const store = new MemoryRuntimeStore(sampleRecord());
  const handlers = new AgentRuntimeHandlerRegistry();
  let invoked = false;
  handlers.register({
    agentId: 'sales_agent',
    capabilityId: 'close_opportunity',
    async execute(task) {
      invoked = true;
      return {
        executionId: task.executionId,
        taskId: task.taskId,
        agentId: 'sales_agent',
        status: 'completed',
        output: { accepted: true },
        evidenceReferences: [],
        knowledgeReferences: [],
        confidence: 0.9,
      };
    },
  });

  const outcome = await orchestrator(store, handlers).execute({
    executionId: 'exec-conflict',
    capabilityId: 'close_opportunity',
    objectiveConflict: conflict('medium'),
  });

  assert.equal(invoked, true);
  assert.equal(outcome.record.task.status, 'completed');
});
