import assert from 'node:assert/strict';
import test from 'node:test';
import { hasVerifiedPaymentEvidence, validatePaymentVerificationInput, type PaymentVerificationResponse } from './payment-integration.js';

test('payment verification input requires provider reference, positive minor amount, currency, and commercial record', () => {
  assert.deepEqual(validatePaymentVerificationInput({ providerPaymentReference: '', expectedAmountMinor: 0, currency: 'zar', commercialRecordReference: '' }), [
    'providerPaymentReference is required.',
    'expectedAmountMinor must be a positive safe integer.',
    'currency must be a three-letter uppercase ISO-style currency code.',
    'commercialRecordReference is required.',
  ]);
  assert.deepEqual(validatePaymentVerificationInput({ providerPaymentReference: 'pay_test_1', expectedAmountMinor: 125000, currency: 'ZAR', commercialRecordReference: 'commercial:test:1' }), []);
});

function response(overrides: Partial<PaymentVerificationResponse> = {}): PaymentVerificationResponse {
  return {
    integrationId: 'payment.test', operation: 'verify_payment', provider: 'deterministic-payment-test', mode: 'sandbox', status: 'succeeded',
    output: { providerPaymentReference: 'pay_test_1', commercialRecordReference: 'commercial:test:1', verificationStatus: 'verified_paid', amountMinor: 125000, currency: 'ZAR', providerEventReference: 'evt_test_1', verifiedAt: '2026-08-17T21:10:00.000Z' },
    evidenceReferences: ['payment-provider:evt_test_1'], retryable: false, ...overrides,
  };
}

test('verified payment evidence requires successful provider evidence and complete verified facts', () => {
  assert.equal(hasVerifiedPaymentEvidence(response()), true);
  assert.equal(hasVerifiedPaymentEvidence(response({ status: 'failed' })), false);
  assert.equal(hasVerifiedPaymentEvidence(response({ evidenceReferences: [] })), false);
  assert.equal(hasVerifiedPaymentEvidence(response({ output: { ...response().output, verificationStatus: 'pending' } })), false);
  const { providerEventReference: _omittedProviderEventReference, ...outputWithoutProviderEventReference } = response().output;
  assert.equal(hasVerifiedPaymentEvidence(response({ output: outputWithoutProviderEventReference })), false);
});
