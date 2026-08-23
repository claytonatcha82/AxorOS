import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { assembleFinanceGovernedCheckoutEmail } from './finance-governed-checkout-email-assembly.js';

function task(overrides: Partial<AgentRuntimeTask> = {}): AgentRuntimeTask {
  const now = new Date().toISOString();
  return {
    taskId: 'task:finance-checkout:1',
    executionId: 'exec:finance-checkout:1',
    originAgent: 'finance_agent',
    destinationAgent: 'finance_agent',
    objective: 'Create governed Finance Gmail draft.',
    priority: 'normal',
    context: {
      financeGovernedCommunication: {
        sourceCommercialRecordReference: 'commercial:1',
        gate: 'PRODUCTION_START',
        sendAuthorised: false,
      },
    },
    knowledgeReferences: [],
    inputs: {
      fromIdentity: 'finance',
      to: [{ address: 'client@example.test' }],
      subject: 'Payment request',
      textBody: 'Please use the governed payment option below.',
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
    correlationId: 'corr:finance-checkout:1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const paymentRequest = {
  requirement: {
    commercialRecordReference: 'commercial:1',
    gate: 'PRODUCTION_START' as const,
    requirementReference: 'requirement:1',
    requirementType: 'DEPOSIT' as const,
    requiredAmountMinor: 12500,
    currency: 'ZAR',
    status: 'ACTIVE' as const,
  },
  providerPaymentReference: 'AXOROS-ABC123',
  authorizationUrl: 'https://checkout.paystack.test/AXOROS-ABC123',
  evidenceReferences: ['payment-paystack-request:AXOROS-ABC123'],
  replayed: false,
};

test('Finance checkout assembly appends only persisted governed checkout authority while retaining Human Executive approval', () => {
  const assembled = assembleFinanceGovernedCheckoutEmail({ task: task(), paymentRequest });
  assert.equal(assembled.approvalRequired, true);
  assert.equal(assembled.approvalOwner, 'human_executive');
  assert.match(String(assembled.inputs.textBody), /https:\/\/checkout\.paystack\.test\/AXOROS-ABC123/);
  assert.match(String(assembled.inputs.textBody), /Payment reference: AXOROS-ABC123/);
  const context = assembled.context.financeGovernedCommunication as Record<string, unknown>;
  assert.equal(context.requirementReference, 'requirement:1');
  assert.equal(context.providerPaymentReference, 'AXOROS-ABC123');
  assert.equal(context.checkoutAuthorityAppendedDeterministically, true);
  assert.equal(context.sendAuthorised, false);
});

test('Finance checkout assembly rejects mismatched commercial authority', () => {
  const mismatched = { ...paymentRequest, requirement: { ...paymentRequest.requirement, commercialRecordReference: 'commercial:other' } };
  assert.throws(
    () => assembleFinanceGovernedCheckoutEmail({ task: task(), paymentRequest: mismatched }),
    /commercial record does not match/,
  );
});

test('Finance checkout assembly rejects bypass of Human Executive approval', () => {
  assert.throws(
    () => assembleFinanceGovernedCheckoutEmail({ task: task({ approvalRequired: false, approvalOwner: undefined }), paymentRequest }),
    /requires Human Executive approval/,
  );
});
