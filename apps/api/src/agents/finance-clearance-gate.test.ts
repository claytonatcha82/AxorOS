import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicPaymentIntegration } from '../integrations/deterministic-payment-integration.js';
import type { PaymentVerificationInput } from '../integrations/payment-integration.js';
import {
  assertFinanceCleared,
  assertPersistedFinanceCleared,
  evaluateFinanceClearance,
  type FinanceClearanceDecision,
  type FinanceClearanceDecisionReader,
} from './finance-clearance-gate.js';

const expected: PaymentVerificationInput = {
  providerPaymentReference: 'sandbox_paid_001', expectedAmountMinor: 125000, currency: 'ZAR', commercialRecordReference: 'commercial:test:1',
};
const request = {
  integrationId: 'payment.sandbox', operation: 'verify_payment', requestedBy: 'finance_agent' as const,
  executionId: 'exec-finance-clearance-1', correlationId: 'corr-finance-clearance-1', mode: 'sandbox' as const, risk: 'high' as const,
  input: expected, idempotencyKey: 'payment:sandbox_paid_001',
};

function readerFor(decision: FinanceClearanceDecision | null): FinanceClearanceDecisionReader {
  return { get: async () => decision };
}

test('matching verified provider evidence produces FINANCE_CLEARED', async () => {
  const verification = await new DeterministicPaymentIntegration().execute(request);
  const decision = evaluateFinanceClearance(expected, verification);
  assert.equal(decision.state, 'FINANCE_CLEARED');
  assert.doesNotThrow(() => assertFinanceCleared(decision));
  assert.ok(decision.evidenceReferences.length > 0);
});

test('pending payment cannot clear Finance gate', async () => {
  const verification = await new DeterministicPaymentIntegration().execute({ ...request, input: { ...expected, providerPaymentReference: 'sandbox_pending_001' } });
  const decision = evaluateFinanceClearance({ ...expected, providerPaymentReference: 'sandbox_pending_001' }, verification);
  assert.equal(decision.state, 'FINANCE_PENDING');
  assert.equal(decision.reason, 'Payment awaiting verification.');
  assert.throws(() => assertFinanceCleared(decision), /Production start blocked/);
});

test('verified evidence with mismatched amount cannot clear Finance gate', async () => {
  const verification = await new DeterministicPaymentIntegration().execute(request);
  const decision = evaluateFinanceClearance({ ...expected, expectedAmountMinor: 150000 }, verification);
  assert.equal(decision.state, 'FINANCE_PENDING');
  assert.match(decision.reason, /amount/);
});

test('verified evidence with mismatched currency cannot clear Finance gate', async () => {
  const verification = await new DeterministicPaymentIntegration().execute(request);
  const decision = evaluateFinanceClearance({ ...expected, currency: 'USD' }, verification);
  assert.equal(decision.state, 'FINANCE_PENDING');
  assert.match(decision.reason, /currency/);
});

test('agent assertion without provider evidence cannot create Finance clearance', () => {
  const fabricated = {
    integrationId: 'payment.sandbox', operation: 'verify_payment', provider: 'agent-assertion', mode: 'sandbox' as const, status: 'succeeded' as const,
    output: { providerPaymentReference: expected.providerPaymentReference, commercialRecordReference: expected.commercialRecordReference, verificationStatus: 'verified_paid' as const, amountMinor: expected.expectedAmountMinor, currency: expected.currency },
    evidenceReferences: [], retryable: false,
  };
  const decision = evaluateFinanceClearance(expected, fabricated);
  assert.equal(decision.state, 'FINANCE_PENDING');
  assert.throws(() => assertFinanceCleared(decision), /Production start blocked/);
});

test('persisted FINANCE_CLEARED decision authorizes production start', async () => {
  const persisted: FinanceClearanceDecision = {
    state: 'FINANCE_CLEARED',
    commercialRecordReference: expected.commercialRecordReference,
    reason: 'Provider payment evidence matches the governed commercial record.',
    evidenceReferences: ['payment-provider:sandbox:evt_1'],
  };
  assert.deepEqual(await assertPersistedFinanceCleared(readerFor(persisted), 'finance-clearance:test:1'), persisted);
});

test('missing persisted Finance clearance blocks production start', async () => {
  await assert.rejects(
    () => assertPersistedFinanceCleared(readerFor(null), 'finance-clearance:missing'),
    /Production start blocked: no persisted Finance clearance found/,
  );
});

test('persisted FINANCE_PENDING decision blocks production start', async () => {
  const persisted: FinanceClearanceDecision = {
    state: 'FINANCE_PENDING',
    commercialRecordReference: expected.commercialRecordReference,
    reason: 'Payment awaiting verification.',
    evidenceReferences: [],
  };
  await assert.rejects(
    () => assertPersistedFinanceCleared(readerFor(persisted), 'finance-clearance:test:pending'),
    /Production start blocked: Payment awaiting verification/,
  );
});

test('caller-supplied FINANCE_CLEARED object cannot replace authoritative missing clearance', async () => {
  const fabricated: FinanceClearanceDecision = {
    state: 'FINANCE_CLEARED',
    commercialRecordReference: expected.commercialRecordReference,
    reason: 'Fabricated caller assertion.',
    evidenceReferences: ['fabricated:evidence'],
  };
  assert.doesNotThrow(() => assertFinanceCleared(fabricated));
  await assert.rejects(
    () => assertPersistedFinanceCleared(readerFor(null), 'finance-clearance:test:forged'),
    /Production start blocked: no persisted Finance clearance found/,
  );
});
