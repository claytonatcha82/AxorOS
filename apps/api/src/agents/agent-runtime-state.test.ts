import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { applyRuntimeEvent, validateRuntimeEvent, type AgentRuntimeExecutionRecord, type AgentRuntimeEvent } from './agent-runtime-state.js';

function task(): AgentRuntimeTask {
  return {
    taskId: 'task-1', executionId: 'exec-1', originAgent: 'operations_agent', destinationAgent: 'sales_agent',
    objective: 'Qualify opportunity', priority: 'normal', context: {}, knowledgeReferences: [], inputs: {},
    expectedOutput: 'Qualification result', dependencies: [], risks: [], confidence: 0.9, approvalRequired: false,
    status: 'queued', nextAction: 'Prepare execution', attempt: 1, maxAttempts: 3, correlationId: 'corr-1',
    createdAt: '2026-08-12T18:00:00.000Z', updatedAt: '2026-08-12T18:00:00.000Z',
  };
}

function event(overrides: Partial<AgentRuntimeEvent> = {}): AgentRuntimeEvent {
  return {
    eventId: 'event-1', executionId: 'exec-1', taskId: 'task-1', correlationId: 'corr-1',
    type: 'status_transitioned', actor: 'runtime', fromStatus: 'queued', toStatus: 'ready', payload: {},
    idempotencyKey: 'idem-1', occurredAt: '2026-08-12T18:01:00.000Z', ...overrides,
  };
}

test('runtime events reject invalid state transitions', () => {
  assert.ok(validateRuntimeEvent(event({ fromStatus: 'queued', toStatus: 'completed' })).some((error) => error.includes('invalid runtime status transition')));
});

test('applying a valid event increments version and updates persisted status', () => {
  const record: AgentRuntimeExecutionRecord = { task: task(), version: 1, persistedAt: '2026-08-12T18:00:00.000Z' };
  const next = applyRuntimeEvent(record, event());
  assert.equal(next.task.status, 'ready');
  assert.equal(next.version, 2);
  assert.equal(next.lastEventId, 'event-1');
});

test('replay cannot apply a transition against stale persisted state', () => {
  const record: AgentRuntimeExecutionRecord = { task: { ...task(), status: 'ready' }, version: 2, persistedAt: '2026-08-12T18:01:00.000Z' };
  assert.throws(() => applyRuntimeEvent(record, event()), /fromStatus does not match persisted runtime state/);
});
