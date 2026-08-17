import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicPaymentIntegration } from './deterministic-payment-integration.js';
import { hasVerifiedPaymentEvidence } from './payment-integration.js';

const integration = new DeterministicPaymentIntegration();
const base = {
  integrationId: 'payment.sandbox', operation: 'verify_payment', requestedBy: 'finance_agent' as const,
  executionId: 'exec-payment-1', correlationId: 'corr-payment-1', mode: 'sandbox' as const, risk: 'high' as const,
  input: { providerPaymentReference: 'sandbox_paid_001', expectedAmountMinor: 125000, currency: 'ZAR', commercialRecordReference: 'commercial:test:1' },
  idempotencyKey: 'payment:sandbox_paid_001',
};

test('deterministic payment verifier returns complete provider evidence for sandbox paid reference', async () => {
  const result = await integration.execute(base);
  assert.equal(result.output.verificationStatus, 'verified_paid');
  assert.equal(result.output.amountMinor, 125000);
  assert.equal(result.output.currency, 'ZAR');
  assert.equal(hasVerifiedPaymentEvidence(result), true);
});

test('pending sandbox payment never qualifies as verified payment evidence', async () => {
  const result = await integration.execute({ ...base, input: { ...base.input, providerPaymentReference: 'sandbox_pending_001' } });
  assert.equal(result.output.verificationStatus, 'pending');
  assert.equal(hasVerifiedPaymentEvidence(result), false);
});

test('non-Finance agent cannot request payment verification', async () => {
  const result = await integration.execute({ ...base, requestedBy: 'operations_agent' });
  assert.equal(result.status, 'blocked');
  assert.equal(hasVerifiedPaymentEvidence(result), false);
});

test('deterministic payment verifier blocks live mode and money movement operations', async () => {
  const live = await integration.execute({ ...base, mode: 'live' });
  assert.equal(live.status, 'blocked');
  const movement = await integration.execute({ ...base, operation: 'refund_payment' });
  assert.equal(movement.status, 'blocked');
});
