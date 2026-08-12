import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowEventForGate } from './finance-alerts.js';

test('finance supplies clearance or hold but does not perform production actions', () => {
  const base = { projectId: 'p1', gateType: 'production_start' as const, required: true, verified: true, checkedAt: '2026-08-12T00:00:00Z' };
  assert.equal(workflowEventForGate({ ...base, status: 'PASSED' }), 'FINANCE_CLEARED');
  assert.equal(workflowEventForGate({ ...base, status: 'WAITING', verified: false, blockingReason: 'deposit not confirmed' }), 'FINANCE_HOLD');
  assert.equal(workflowEventForGate({ ...base, status: 'MANUAL_REVIEW', blockingReason: 'payment disputed' }), 'FINANCE_HOLD');
});
