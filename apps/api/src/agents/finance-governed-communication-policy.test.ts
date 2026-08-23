import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinanceGovernedOperationalDecision } from './finance-governed-operational-coordinator.js';
import { decideFinanceGovernedCommunication } from './finance-governed-communication-policy.js';

function decision(
  state: FinanceGovernedOperationalDecision['state'],
  overrides: Partial<FinanceGovernedOperationalDecision> = {},
): FinanceGovernedOperationalDecision {
  return {
    commercialRecordReference: 'commercial:finance-communication:1',
    gate: 'PRODUCTION_START',
    state,
    reason: state,
    advisoryModelAllowed: true,
    ...overrides,
  };
}

test('unverified payment permits only a cautious verification draft and never authorises send', () => {
  const result = decideFinanceGovernedCommunication(decision('AWAITING_VERIFIED_PAYMENT'));
  assert.equal(result.intent, 'DRAFT_PAYMENT_VERIFICATION_REQUEST');
  assert.equal(result.clientCommunicationAllowed, true);
  assert.equal(result.modelDraftAllowed, true);
  assert.equal(result.humanApprovalRequired, true);
  assert.equal(result.sendAuthorised, false);
});

test('ready-to-bind payment cannot be communicated as confirmed before satisfaction is persisted', () => {
  const result = decideFinanceGovernedCommunication(decision('READY_TO_BIND_REQUIREMENT', {
    paymentEvidenceReference: 'payment-provider:paystack:event:1',
    paymentStatus: 'CONFIRMED',
    authorityState: 'AUTHORIZED',
  }));
  assert.equal(result.intent, 'INTERNAL_BINDING_PENDING');
  assert.equal(result.clientCommunicationAllowed, false);
  assert.equal(result.modelDraftAllowed, false);
  assert.equal(result.sendAuthorised, false);
});

test('satisfied requirement permits a payment-confirmation draft only with persisted clearance evidence', () => {
  const result = decideFinanceGovernedCommunication(decision('REQUIREMENT_SATISFIED', {
    clearanceId: 'finance-clearance:1',
  }));
  assert.equal(result.intent, 'DRAFT_PAYMENT_CONFIRMATION');
  assert.equal(result.clientCommunicationAllowed, true);
  assert.equal(result.modelDraftAllowed, true);
  assert.deepEqual(result.evidenceReferences, ['finance-clearance:1']);
  assert.equal(result.sendAuthorised, false);
});

test('satisfied requirement without clearance evidence fails closed', () => {
  assert.throws(
    () => decideFinanceGovernedCommunication(decision('REQUIREMENT_SATISFIED')),
    /requires persisted clearance evidence/,
  );
});

test('manual-review and missing/inactive requirement states remain internal only', () => {
  for (const state of ['MANUAL_REVIEW', 'BLOCKED_MISSING_REQUIREMENT', 'BLOCKED_REQUIREMENT_INACTIVE'] as const) {
    const result = decideFinanceGovernedCommunication(decision(state));
    assert.equal(result.intent, 'INTERNAL_REVIEW_ONLY');
    assert.equal(result.clientCommunicationAllowed, false);
    assert.equal(result.modelDraftAllowed, false);
    assert.equal(result.sendAuthorised, false);
  }
});
