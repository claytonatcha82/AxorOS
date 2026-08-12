import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeIdempotencyRecord } from './agent-runtime-idempotency.js';
import { recoverStaleRuntimeExecutions } from './agent-runtime-recovery.js';
import type { AgentRuntimeExecutionRecord, AgentRuntimeEvent } from './agent-runtime-state.js';
import type { AgentRuntimeStore, RuntimeMutation } from './agent-runtime-store.js';
import { RuntimeVersionConflictError } from './agent-runtime-store.js';

function sampleRecord(priority: 'normal' | 'critical' = 'normal', risks: string[] = []): AgentRuntimeExecutionRecord {
  return {
    task: {
      taskId: 'task-1',
      executionId: 'exec-1',
      originAgent: 'operations_agent',
      destinationAgent: 'lead_agent',
      objective: 'Generate qualified opportunities',
      priority,
      context: {},
      knowledgeReferences: [],
      inputs: {},
      expectedOutput: 'Qualified lead',
      dependencies: [],
      risks,
      confidence: 0.9,
      approvalRequired: false,
      status: 'in_progress',
      nextAction: 'execute_destination_capability',
      attempt: 1,
      maxAttempts: 3,
      correlationId: 'corr-1',
      createdAt: '2026-08-12T18:00:00.000Z',
      updatedAt: '2026-08-12T18:00:00.000Z',
    },
    version: 2,
    persistedAt: '2026-08-12T18:00:00.000Z',
  };
}

class RecoveryStore implements AgentRuntimeStore {
  execution: AgentRuntimeExecutionRecord;
  readonly events: AgentRuntimeEvent[] = [];
  readonly idempotency = new Map<string, RuntimeIdempotencyRecord>();
  atomicCommits = 0;

  constructor(record: AgentRuntimeExecutionRecord) {
    this.execution = record;
  }

  async getExecution(executionId: string) {
    return this.execution.task.executionId === executionId ? this.execution : null;
  }

  async saveExecution(record: AgentRuntimeExecutionRecord, expectedVersion: number) {
    if (this.execution.version !== expectedVersion) throw new RuntimeVersionConflictError(record.task.executionId);
    this.execution = record;
  }

  async appendEvent(event: AgentRuntimeEvent) {
    this.events.push(event);
  }

  async listEvents(executionId: string) {
    return this.events.filter((event) => event.executionId === executionId);
  }

  async hasIdempotencyKey(idempotencyKey: string) {
    return this.idempotency.has(idempotencyKey);
  }

  async saveIdempotencyRecord(record: RuntimeIdempotencyRecord) {
    this.idempotency.set(record.idempotencyKey, record);
  }

  async commitRuntimeMutation(mutation: RuntimeMutation) {
    if (this.execution.version !== mutation.expectedVersion) throw new RuntimeVersionConflictError(mutation.record.task.executionId);
    this.execution = mutation.record;
    this.events.push(mutation.event);
    this.idempotency.set(mutation.idempotencyRecord.idempotencyKey, mutation.idempotencyRecord);
    this.atomicCommits += 1;
  }

  async listStaleInProgressExecutions(before: string, limit: number) {
    if (this.execution.task.status === 'in_progress' && this.execution.persistedAt < before) return [this.execution].slice(0, limit);
    return [];
  }
}

const recoveryOptions = {
  staleAfterMs: 5 * 60 * 1000,
  now: () => '2026-08-12T18:10:00.000Z',
  createEventId: () => 'recovery-event-1',
};

test('routine stale execution moves to Operations review without automatic retry', async () => {
  const store = new RecoveryStore(sampleRecord());
  const decisions = await recoverStaleRuntimeExecutions(store, recoveryOptions);

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.action, 'review');
  assert.equal(store.execution.task.status, 'review');
  assert.equal(store.execution.task.approvalRequired, true);
  assert.equal(store.execution.task.approvalOwner, 'operations_agent');
  assert.equal(store.execution.task.nextAction, 'operations_reconcile_stale_execution_before_retry');
  assert.equal(store.events[0]?.payload.automaticRetry, false);
  assert.equal(store.atomicCommits, 1);
});

test('critical stale execution escalates to Human Executive', async () => {
  const store = new RecoveryStore(sampleRecord('critical'));
  const decisions = await recoverStaleRuntimeExecutions(store, recoveryOptions);

  assert.equal(decisions[0]?.action, 'escalate');
  assert.equal(store.execution.task.status, 'escalated');
  assert.equal(store.execution.task.approvalOwner, 'human_executive');
  assert.equal(store.execution.task.nextAction, 'human_executive_reconcile_stale_execution');
});

test('risk-bearing stale execution escalates even when priority is normal', async () => {
  const store = new RecoveryStore(sampleRecord('normal', ['external_side_effect_uncertain']));
  const decisions = await recoverStaleRuntimeExecutions(store, recoveryOptions);

  assert.equal(decisions[0]?.action, 'escalate');
  assert.equal(store.execution.task.status, 'escalated');
});

test('fresh in-progress execution is not recovered', async () => {
  const record = sampleRecord();
  record.persistedAt = '2026-08-12T18:09:00.000Z';
  const store = new RecoveryStore(record);
  const decisions = await recoverStaleRuntimeExecutions(store, recoveryOptions);

  assert.equal(decisions.length, 0);
  assert.equal(store.execution.task.status, 'in_progress');
  assert.equal(store.atomicCommits, 0);
});
