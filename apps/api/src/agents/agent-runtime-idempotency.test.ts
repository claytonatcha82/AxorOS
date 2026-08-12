import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeEvent } from './agent-runtime-state.js';
import { assertRuntimeEventIsReplaySafe, isDuplicateRuntimeEvent, recordRuntimeIdempotency, runtimeIdempotencyKey } from './agent-runtime-idempotency.js';

const event: AgentRuntimeEvent = {
  eventId: 'event-1', executionId: 'exec-1', taskId: 'task-1', correlationId: 'corr-1',
  type: 'dispatch_succeeded', actor: 'runtime', payload: {}, idempotencyKey: 'dispatch:exec-1:sales_agent',
  occurredAt: '2026-08-12T18:05:00.000Z',
};

test('runtime idempotency keys are deterministic', () => {
  assert.equal(runtimeIdempotencyKey('dispatch', 'exec-1', 'sales_agent'), 'dispatch:exec-1:sales_agent');
});

test('duplicate runtime events are detected and blocked', () => {
  const seen = new Set([event.idempotencyKey]);
  assert.equal(isDuplicateRuntimeEvent(event, seen), true);
  assert.throws(() => assertRuntimeEventIsReplaySafe(event, seen), /duplicate runtime event blocked/);
});

test('new runtime events are recordable for durable replay protection', () => {
  const seen = new Set<string>();
  assert.doesNotThrow(() => assertRuntimeEventIsReplaySafe(event, seen));
  const record = recordRuntimeIdempotency(event, 'dispatch');
  assert.equal(record.completed, true);
  assert.equal(record.executionId, 'exec-1');
});
