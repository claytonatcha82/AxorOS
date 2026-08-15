import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { createRuntimeRecoveryRunner } from './agent-runtime-recovery-runner.js';

function staleRecord(priority: 'normal' | 'critical' = 'normal'): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'task-1',
      executionId: 'exec-1',
      originAgent: 'operations_agent',
      destinationAgent: 'marketing_agent',
      objective: 'Generate copy',
      priority,
      context: {},
      knowledgeReferences: [],
      inputs: {},
      expectedOutput: 'Copy',
      dependencies: [],
      risks: priority === 'critical' ? ['external_side_effect_uncertain'] : [],
      confidence: 0.9,
      approvalRequired: false,
      status: 'in_progress',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 3,
      correlationId: 'corr-1',
      createdAt: '2026-08-15T08:00:00.000Z',
      updatedAt: '2026-08-15T08:00:00.000Z',
    },
    version: 1,
    persistedAt: '2026-08-15T08:00:00.000Z',
  };
}

class RecoveryStore implements AgentRuntimeStore {
  record: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();

  constructor(record: AgentRuntimeExecutionRecord) {
    this.record = record;
  }

  async getExecution() { return this.record; }
  async saveExecution(record: AgentRuntimeExecutionRecord) { this.record = record; }
  async appendEvent(event: AgentRuntimeEvent) { this.events.push(event); }
  async listEvents() { return this.events; }
  async hasIdempotencyKey(key: string) { return this.idempotency.has(key); }
  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord) { this.idempotency.set(record.idempotencyKey, record); }
  async listStaleInProgressExecutions() { return this.record.task.status === 'in_progress' ? [this.record] : []; }
}

test('recovery runner moves routine stale work to Operations review without retry', async () => {
  const store = new RecoveryStore(staleRecord());
  const runner = createRuntimeRecoveryRunner(store, {
    staleAfterMs: 60_000,
    now: () => '2026-08-15T08:10:00.000Z',
    createEventId: () => 'event-1',
  });

  const decisions = await runner.runOnce();

  assert.equal(decisions[0]?.action, 'review');
  assert.equal(store.record.task.status, 'review');
  assert.equal(store.record.task.approvalOwner, 'operations_agent');
  assert.equal(store.record.task.nextAction, 'operations_reconcile_stale_execution_before_retry');
  assert.equal(store.events[0]?.payload.automaticRetry, false);
});

test('recovery runner escalates critical stale work to Human Executive', async () => {
  const store = new RecoveryStore(staleRecord('critical'));
  const runner = createRuntimeRecoveryRunner(store, {
    staleAfterMs: 60_000,
    now: () => '2026-08-15T08:10:00.000Z',
    createEventId: () => 'event-1',
  });

  const decisions = await runner.runOnce();

  assert.equal(decisions[0]?.action, 'escalate');
  assert.equal(store.record.task.status, 'escalated');
  assert.equal(store.record.task.approvalOwner, 'human_executive');
  assert.equal(store.record.task.nextAction, 'human_executive_reconcile_stale_execution');
});
