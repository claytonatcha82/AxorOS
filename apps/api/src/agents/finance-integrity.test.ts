import assert from 'node:assert/strict';
import test from 'node:test';
import { financeEventKey, isDuplicateProviderEvent, manualAdjustmentMayApply, reconciliationStatus, refundMayExecute } from './finance-integrity.js';

test('duplicate provider events are detected deterministically', () => {
  const key = financeEventKey({ provider: 'gateway', providerEventId: 'evt-1' });
  assert.equal(isDuplicateProviderEvent(new Set([key]), { provider: 'gateway', providerEventId: 'evt-1' }), true);
  assert.equal(isDuplicateProviderEvent(new Set([key]), { provider: 'gateway', providerEventId: 'evt-2' }), false);
});

test('reconciliation only matches when provider and AxorOS records fully align', () => {
  assert.equal(reconciliationStatus({ provider: 'gateway', expectedTransactions: 10, providerTransactions: 10, matched: 10, missingInternal: 0, missingProvider: 0, amountMismatches: 0 }), 'MATCHED');
  assert.equal(reconciliationStatus({ provider: 'gateway', expectedTransactions: 10, providerTransactions: 10, matched: 9, missingInternal: 1, missingProvider: 0, amountMismatches: 0 }), 'EXCEPTIONS');
});

test('manual financial adjustments require evidence and approval', () => {
  assert.equal(manualAdjustmentMayApply({ adjustmentId: 'a1', recordType: 'payment', recordId: 'p1', previousValue: 'PENDING', newValue: 'CONFIRMED', reason: 'provider evidence supplied', evidence: ['provider://proof'], requestedBy: 'finance_agent', approvedBy: 'human_executive' }), true);
  assert.equal(manualAdjustmentMayApply({ adjustmentId: 'a2', recordType: 'payment', recordId: 'p2', previousValue: 'PENDING', newValue: 'CONFIRMED', reason: 'manual claim', evidence: [], requestedBy: 'finance_agent' }), false);
});

test('refund cannot exceed refundable amount and requires human approval', () => {
  assert.equal(refundMayExecute({ originalAmountMinor: 100000, alreadyRefundedMinor: 20000, requestedAmountMinor: 80000, policySupported: true, humanApproved: true }), true);
  assert.equal(refundMayExecute({ originalAmountMinor: 100000, alreadyRefundedMinor: 20000, requestedAmountMinor: 90000, policySupported: true, humanApproved: true }), false);
  assert.equal(refundMayExecute({ originalAmountMinor: 100000, alreadyRefundedMinor: 0, requestedAmountMinor: 100000, policySupported: true, humanApproved: false }), false);
});
