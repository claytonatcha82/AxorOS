import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasUsablePaymentRequest,
  validatePaymentRequestInitializationInput,
  type PaymentRequestInitializationResponse,
} from './payment-request-integration.js';

test('payment request initialization validation accepts complete governed input', () => {
  assert.deepEqual(validatePaymentRequestInitializationInput({
    commercialRecordReference: 'commercial:test:1',
    requirementReference: 'deposit:commercial:test:1',
    providerPaymentReference: 'AXOROS-TEST-1',
    recipientEmail: 'client@example.com',
    amountMinor: 10000,
    currency: 'ZAR',
  }), []);
});

test('payment request initialization rejects invalid authority inputs', () => {
  const errors = validatePaymentRequestInitializationInput({
    commercialRecordReference: ' ',
    requirementReference: '',
    providerPaymentReference: ' ',
    recipientEmail: 'invalid',
    amountMinor: 0,
    currency: 'zar',
  });
  assert.equal(errors.length, 6);
});

test('usable payment request requires provider URL, access code, and evidence', () => {
  const response: PaymentRequestInitializationResponse = {
    integrationId: 'payment.paystack.request',
    operation: 'initialize_payment_request',
    provider: 'paystack',
    mode: 'sandbox',
    status: 'succeeded',
    output: {
      commercialRecordReference: 'commercial:test:1',
      requirementReference: 'deposit:commercial:test:1',
      providerPaymentReference: 'AXOROS-TEST-1',
      authorizationUrl: 'https://checkout.paystack.test/abc',
      accessCode: 'abc',
    },
    evidenceReferences: ['payment-paystack-request:AXOROS-TEST-1'],
    retryable: false,
  };
  assert.equal(hasUsablePaymentRequest(response), true);
  assert.equal(hasUsablePaymentRequest({ ...response, evidenceReferences: [] }), false);
});
