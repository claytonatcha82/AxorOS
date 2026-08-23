import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinanceAdvisoryContext } from './finance-advisory-context.js';

function decision(overrides = {}) {
  return {
    commercialRecordReference: 'commercial:finance-advisory:1',
    gate: 'PRODUCTION_START',
    state: 'READY_TO_BIND_REQUIREMENT',
    reason: 'Verified provider payment evidence supports governed commercial payment binding, but the requirement is not yet satisfied.',
    requirementReference: 'deposit:commercial:finance-advisory:1',
    paymentEvidenceReference: 'payment-provider:paystack:event:1',
    paymentStatus: 'CONFIRMED',
    authorityState: 'AUTHORIZED',
    advisoryModelAllowed: true,
    ...overrides,
  } as const;
}

test('Finance advisory context preserves deterministic decision as authoritative model input', () => {
  const context = buildFinanceAdvisoryContext(decision());
  assert.match(context.financeContext, /AUTHORITATIVE DETERMINISTIC FINANCE ASSESSMENT/);
  assert.match(context.financeContext, /READY_TO_BIND_REQUIREMENT/);
  assert.match(context.financeContext, /CONFIRMED/);
  assert.match(context.financeContext, /AUTHORIZED/);
  assert.match(context.financeContext, /cannot confirm payment/);
  assert.ok(context.knowledgeReferences.includes('finance:commercial-record:commercial:finance-advisory:1'));
  assert.ok(context.knowledgeReferences.includes('finance:requirement:deposit:commercial:finance-advisory:1'));
  assert.ok(context.knowledgeReferences.includes('finance:evidence:payment-provider:paystack:event:1'));
});

test('Finance advisory context does not invent missing clearance or payment evidence', () => {
  const context = buildFinanceAdvisoryContext(decision({
    state: 'AWAITING_VERIFIED_PAYMENT',
    reason: 'No authoritative provider payment state has been persisted for this reference.',
    requirementReference: 'deposit:commercial:finance-advisory:1',
    paymentEvidenceReference: undefined,
    paymentStatus: undefined,
    authorityState: undefined,
  }));
  assert.match(context.financeContext, /AWAITING_VERIFIED_PAYMENT/);
  assert.match(context.financeContext, /"clearanceId":null/);
  assert.match(context.financeContext, /"paymentEvidenceReference":null/);
  assert.equal(context.knowledgeReferences.some((reference) => reference.startsWith('finance:evidence:')), false);
  assert.equal(context.knowledgeReferences.some((reference) => reference.startsWith('finance:clearance:')), false);
});

test('Finance advisory context includes immutable clearance reference only when supplied by deterministic decision', () => {
  const context = buildFinanceAdvisoryContext(decision({
    state: 'REQUIREMENT_SATISFIED',
    clearanceId: 'finance-clearance:1',
  }));
  assert.ok(context.knowledgeReferences.includes('finance:clearance:finance-clearance:1'));
  assert.match(context.financeContext, /finance-clearance:1/);
});
