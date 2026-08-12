import assert from 'node:assert/strict';
import test from 'node:test';
import { mayPromoteToProcessMemory, validateOperationsMemory } from './operations-memory.js';

test('temporary operational context requires an expiry', () => {
  const errors = validateOperationsMemory({ id: 'm1', layer: 'temporary', content: 'Client assets delayed this week', sourceWorkflowId: 'wf-1' });
  assert.ok(errors.includes('temporary memory requires expiresAt.'));
});

test('operational incidents cannot silently become permanent process rules', () => {
  assert.equal(mayPromoteToProcessMemory({ id: 'm2', layer: 'operational', content: 'One project needed extra QA', sourceWorkflowId: 'wf-2' }), false);
  assert.equal(mayPromoteToProcessMemory({ id: 'm2', layer: 'operational', content: 'Repeated QA bottleneck', sourceWorkflowId: 'wf-2', humanApprovedForProcessPromotion: true }), true);
});
