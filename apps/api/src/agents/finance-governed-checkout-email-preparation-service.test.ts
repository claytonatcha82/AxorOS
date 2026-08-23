import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { createFinanceGovernedCheckoutEmailPreparationService } from './finance-governed-checkout-email-preparation-service.js';

const decision = {
  commercialRecordReference: 'commercial:checkout-email:1',
  gate: 'PRODUCTION_START' as const,
  state: 'AWAITING_VERIFIED_PAYMENT' as const,
  reason: 'Payment is awaiting verification.',
  paymentStatus: 'pending',
  authorityState: 'not_cleared',
  requirementReference: 'requirement:checkout-email:1',
  evidenceReferences: ['workflow-event:finance:1'],
  advisoryModelAllowed: true,
};

function preparedTask(): AgentRuntimeTask {
  const now = new Date().toISOString();
  return {
    taskId: 'task:finance-checkout-email:1',
    executionId: 'exec:finance-checkout-email:1',
    originAgent: 'finance_agent',
    destinationAgent: 'finance_agent',
    objective: 'Create governed Finance Gmail draft.',
    priority: 'normal',
    context: {
      financeGovernedCommunication: {
        sourceCommercialRecordReference: decision.commercialRecordReference,
        gate: decision.gate,
        sendAuthorised: false,
      },
    },
    knowledgeReferences: [],
    inputs: {
      fromIdentity: 'finance',
      to: [{ email: 'client@example.test' }],
      subject: 'Secure payment link',
      textBody: 'Please use the secure payment option below.',
    },
    expectedOutput: 'One Human Executive-approved Finance Gmail draft',
    dependencies: [],
    risks: [],
    confidence: 1,
    approvalRequired: true,
    approvalOwner: 'human_executive',
    status: 'review',
    nextAction: 'await_human_executive_approval',
    attempt: 1,
    maxAttempts: 1,
    correlationId: 'corr:finance-checkout-email:1',
    createdAt: now,
    updatedAt: now,
  };
}

test('Finance checkout email preparation derives payment request recipient from the single governed email recipient and appends authority after draft policy', async () => {
  let capturedRecipient = '';
  let preparationCalls = 0;
  const service = createFinanceGovernedCheckoutEmailPreparationService({
    paymentRequestService: {
      async initialize(input) {
        capturedRecipient = input.recipientEmail;
        return {
          requirement: {
            commercialRecordReference: decision.commercialRecordReference,
            gate: decision.gate,
            requirementReference: decision.requirementReference,
            requirementType: 'DEPOSIT',
            requiredAmountMinor: 12500,
            currency: 'ZAR',
            status: 'ACTIVE',
          },
          providerPaymentReference: 'AXOROS-CHECKOUT-1',
          authorizationUrl: 'https://checkout.paystack.test/AXOROS-CHECKOUT-1',
          evidenceReferences: ['payment-paystack-request:AXOROS-CHECKOUT-1'],
          replayed: false,
        };
      },
    },
    emailPreparationService: {
      async prepare() {
        preparationCalls += 1;
        return preparedTask();
      },
    },
  });

  const task = await service.prepare({
    executionId: 'exec:finance-checkout-email:1',
    correlationId: 'corr:finance-checkout-email:1',
    decision,
    to: [{ email: 'client@example.test' }],
    subject: 'Secure payment link',
  });

  assert.equal(capturedRecipient, 'client@example.test');
  assert.equal(preparationCalls, 1);
  assert.equal(task.approvalRequired, true);
  assert.equal(task.approvalOwner, 'human_executive');
  assert.match(String(task.inputs.textBody), /https:\/\/checkout\.paystack\.test\/AXOROS-CHECKOUT-1/);
  const context = task.context.financeGovernedCommunication as Record<string, unknown>;
  assert.equal(context.providerPaymentReference, 'AXOROS-CHECKOUT-1');
  assert.equal(context.checkoutAuthorityAppendedDeterministically, true);
  assert.equal(context.sendAuthorised, false);
});

test('Finance checkout email preparation rejects multiple recipients before creating payment authority', async () => {
  let paymentCalls = 0;
  const service = createFinanceGovernedCheckoutEmailPreparationService({
    paymentRequestService: {
      async initialize() {
        paymentCalls += 1;
        throw new Error('should not execute');
      },
    },
    emailPreparationService: {
      async prepare() {
        throw new Error('should not execute');
      },
    },
  });

  await assert.rejects(
    () => service.prepare({
      executionId: 'exec:multi',
      correlationId: 'corr:multi',
      decision,
      to: [{ email: 'one@example.test' }, { email: 'two@example.test' }],
      subject: 'Secure payment link',
    }),
    /exactly one recipient/,
  );
  assert.equal(paymentCalls, 0);
});
