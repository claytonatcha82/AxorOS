import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceGovernedBindingService } from './finance-governed-binding-service.js';

function decision(state: 'READY_TO_BIND_REQUIREMENT' | 'AWAITING_VERIFIED_PAYMENT' | 'REQUIREMENT_SATISFIED') {
  return {
    commercialRecordReference: 'commercial:finance-binding:1',
    gate: 'PRODUCTION_START' as const,
    state,
    reason: state,
    requirementReference: 'deposit:commercial:finance-binding:1',
    advisoryModelAllowed: true,
    ...(state === 'READY_TO_BIND_REQUIREMENT' ? {
      paymentEvidenceReference: 'payment-provider:paystack:event:1',
      paymentStatus: 'CONFIRMED' as const,
      authorityState: 'AUTHORIZED' as const,
    } : {}),
    ...(state === 'REQUIREMENT_SATISFIED' ? { clearanceId: 'finance-clearance:1' } : {}),
  };
}

test('Finance governed binding requires deterministic readiness before binding and satisfaction after binding', async () => {
  let assessmentCalls = 0;
  let bindingCalls = 0;
  const service = createFinanceGovernedBindingService({
    coordinator: {
      async assess() {
        assessmentCalls += 1;
        return assessmentCalls === 1 ? decision('READY_TO_BIND_REQUIREMENT') : decision('REQUIREMENT_SATISFIED');
      },
    },
    bindingWorkflow: {
      async bindAndSatisfy() {
        bindingCalls += 1;
        return {
          requirement: {
            commercialRecordReference: 'commercial:finance-binding:1', gate: 'PRODUCTION_START',
            requirementReference: 'deposit:commercial:finance-binding:1', requirementType: 'DEPOSIT',
            requiredAmountMinor: 10000, currency: 'ZAR', status: 'ACTIVE',
          },
          evidence: {
            idempotencyKey: 'payment-webhook:paystack:event:1', provider: 'paystack',
            providerEventReference: 'event:1', providerPaymentReference: 'payment:1', eventType: 'payment_paid',
            commercialRecordReference: 'commercial:finance-binding:1', amountMinor: 10000, currency: 'ZAR',
            occurredAt: new Date().toISOString(), evidenceReference: 'payment-provider:paystack:event:1',
          },
          clearance: {
            decision: {
              clearanceId: 'finance-clearance:1', commercialRecordReference: 'commercial:finance-binding:1',
              providerPaymentReference: 'payment:1', state: 'FINANCE_CLEARED', reason: 'verified',
              evidenceReferences: ['payment-provider:paystack:event:1'], amountMinor: 10000, currency: 'ZAR',
              verifiedAt: new Date().toISOString(),
            },
            persistence: 'accepted',
          },
          satisfactionPersistence: 'accepted',
        };
      },
    },
    paymentIntegrationId: 'payment.paystack',
    mode: 'sandbox',
  });

  const result = await service.bind({
    commercialRecordReference: 'commercial:finance-binding:1', gate: 'PRODUCTION_START', provider: 'paystack',
    providerPaymentReference: 'payment:1', trustedPaymentWebhookIdempotencyKey: 'payment-webhook:paystack:event:1',
    clearanceId: 'finance-clearance:1', executionId: 'exec:finance-binding:1', correlationId: 'corr:finance-binding:1',
  });

  assert.equal(bindingCalls, 1);
  assert.equal(result.before.state, 'READY_TO_BIND_REQUIREMENT');
  assert.equal(result.after.state, 'REQUIREMENT_SATISFIED');
});

test('Finance governed binding fails closed before binding when deterministic assessment is not ready', async () => {
  let bindingCalls = 0;
  const service = createFinanceGovernedBindingService({
    coordinator: { async assess() { return decision('AWAITING_VERIFIED_PAYMENT'); } },
    bindingWorkflow: {
      async bindAndSatisfy() {
        bindingCalls += 1;
        throw new Error('must not run');
      },
    },
    paymentIntegrationId: 'payment.paystack',
    mode: 'sandbox',
  });

  await assert.rejects(() => service.bind({
    commercialRecordReference: 'commercial:finance-binding:1', gate: 'PRODUCTION_START', provider: 'paystack',
    providerPaymentReference: 'payment:1', trustedPaymentWebhookIdempotencyKey: 'payment-webhook:paystack:event:1',
    clearanceId: 'finance-clearance:1', executionId: 'exec:finance-binding:blocked', correlationId: 'corr:finance-binding:blocked',
  }), /requires READY_TO_BIND_REQUIREMENT/);
  assert.equal(bindingCalls, 0);
});
