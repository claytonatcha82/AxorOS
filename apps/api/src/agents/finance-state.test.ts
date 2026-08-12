import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionInvoice, evaluateFinancialGate, invoicePaymentStatus } from './finance-state.js';

test('invoice lifecycle preserves controlled state transitions', () => {
  assert.equal(canTransitionInvoice('DRAFT', 'APPROVED'), true);
  assert.equal(canTransitionInvoice('DRAFT', 'PAID'), false);
  assert.equal(canTransitionInvoice('PAID', 'SENT'), false);
});

test('financial gate requires verified provider evidence and configured amount', () => {
  assert.equal(evaluateFinancialGate({ required: true, requiredAmountMinor: 500000, confirmedAmountMinor: 500000, providerVerified: false, disputed: false }), 'WAITING');
  assert.equal(evaluateFinancialGate({ required: true, requiredAmountMinor: 500000, confirmedAmountMinor: 250000, providerVerified: true, disputed: false }), 'WAITING');
  assert.equal(evaluateFinancialGate({ required: true, requiredAmountMinor: 500000, confirmedAmountMinor: 500000, providerVerified: true, disputed: false }), 'PASSED');
  assert.equal(evaluateFinancialGate({ required: true, requiredAmountMinor: 500000, confirmedAmountMinor: 500000, providerVerified: true, disputed: true }), 'MANUAL_REVIEW');
});

test('partial payment is represented explicitly', () => {
  assert.equal(invoicePaymentStatus(100000, 0), 'SENT');
  assert.equal(invoicePaymentStatus(100000, 50000), 'PARTIALLY_PAID');
  assert.equal(invoicePaymentStatus(100000, 100000), 'PAID');
});
