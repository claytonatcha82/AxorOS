import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersistedFinanceClearanceDecision } from '../data/finance-clearance-postgres-store.js';
import type { ExternalIntegration } from '../integrations/integration-contract.js';
import { DeterministicPaymentIntegration } from '../integrations/deterministic-payment-integration.js';
import { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { PaymentVerificationInput, PaymentVerificationOutput } from '../integrations/payment-integration.js';
import { createFinancePaymentClearanceWorkflow } from './finance-payment-clearance-workflow.js';

const expected: PaymentVerificationInput = {
  providerPaymentReference: 'sandbox_paid_workflow_001',
  expectedAmountMinor: 125000,
  currency: 'ZAR',
  commercialRecordReference: 'commercial:workflow:1',
};

function createStore() {
  const decisions: PersistedFinanceClearanceDecision[] = [];
  return {
    decisions,
    store: {
      async save(decision: PersistedFinanceClearanceDecision) {
        decisions.push(decision);
        return 'accepted' as const;
      },
    },
  };
}

function baseInput(overrides: Partial<Parameters<ReturnType<typeof createFinancePaymentClearanceWorkflow>['verifyAndPersist']>[0]> = {}) {
  return {
    clearanceId: 'finance-clearance:workflow:1',
    executionId: 'exec-finance-workflow-1',
    correlationId: 'corr-finance-workflow-1',
    paymentIntegrationId: 'payment.sandbox',
    mode: 'sandbox' as const,
    expected,
    ...overrides,
  };
}

test('Finance workflow verifies payment through governed integration and persists FINANCE_CLEARED evidence', async () => {
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicPaymentIntegration());
  const { store, decisions } = createStore();
  const workflow = createFinancePaymentClearanceWorkflow({ integrations, clearanceStore: store });

  const result = await workflow.verifyAndPersist(baseInput());

  assert.equal(result.persistence, 'accepted');
  assert.equal(result.decision.state, 'FINANCE_CLEARED');
  assert.equal(result.decision.providerPaymentReference, expected.providerPaymentReference);
  assert.equal(result.decision.commercialRecordReference, expected.commercialRecordReference);
  assert.equal(result.decision.amountMinor, expected.expectedAmountMinor);
  assert.equal(result.decision.currency, expected.currency);
  assert.equal(result.decision.verifiedAt, '2026-08-17T00:00:00.000Z');
  assert.ok(result.decision.evidenceReferences.length > 0);
  assert.deepEqual(decisions, [result.decision]);
});

test('pending provider verification persists FINANCE_PENDING and cannot manufacture clearance', async () => {
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicPaymentIntegration());
  const { store } = createStore();
  const workflow = createFinancePaymentClearanceWorkflow({ integrations, clearanceStore: store });
  const pendingExpected = { ...expected, providerPaymentReference: 'sandbox_pending_workflow_001' };

  const result = await workflow.verifyAndPersist(baseInput({ expected: pendingExpected }));

  assert.equal(result.decision.state, 'FINANCE_PENDING');
  assert.equal(result.decision.reason, 'Payment awaiting verification.');
  assert.equal(result.decision.verifiedAt, '1970-01-01T00:00:00.000Z');
});

test('mismatched provider facts persist FINANCE_PENDING rather than trusting the payment response', async () => {
  const integrations = new IntegrationRegistry();
  const mismatched: ExternalIntegration<PaymentVerificationInput, PaymentVerificationOutput> = {
    integrationId: 'payment.mismatch',
    kind: 'payment',
    provider: 'mismatch-provider',
    supportedModes: ['sandbox'],
    supportedOperations: ['verify_payment'],
    async execute(request) {
      return {
        integrationId: this.integrationId,
        operation: request.operation,
        provider: this.provider,
        mode: request.mode,
        status: 'succeeded',
        output: {
          providerPaymentReference: request.input.providerPaymentReference,
          commercialRecordReference: request.input.commercialRecordReference,
          verificationStatus: 'verified_paid',
          amountMinor: request.input.expectedAmountMinor - 1,
          currency: request.input.currency,
          providerEventReference: 'evt-mismatch-1',
          verifiedAt: '2026-08-18T17:30:00.000Z',
        },
        evidenceReferences: ['payment-provider:mismatch:evt-mismatch-1'],
        retryable: false,
      };
    },
  };
  integrations.register(mismatched);
  const { store } = createStore();
  const workflow = createFinancePaymentClearanceWorkflow({ integrations, clearanceStore: store });

  const result = await workflow.verifyAndPersist(baseInput({ paymentIntegrationId: 'payment.mismatch' }));

  assert.equal(result.decision.state, 'FINANCE_PENDING');
  assert.match(result.decision.reason, /amount/);
});

test('Finance workflow fixes requestedBy, operation, risk and idempotency key instead of accepting caller authority', async () => {
  let capturedRequest: Record<string, unknown> | undefined;
  const integrations = {
    async execute(request: Record<string, unknown>) {
      capturedRequest = request;
      return {
        integrationId: 'payment.capture',
        operation: 'verify_payment',
        provider: 'capture-provider',
        mode: 'sandbox' as const,
        status: 'succeeded' as const,
        output: {
          providerPaymentReference: expected.providerPaymentReference,
          commercialRecordReference: expected.commercialRecordReference,
          verificationStatus: 'verified_paid' as const,
          amountMinor: expected.expectedAmountMinor,
          currency: expected.currency,
          providerEventReference: 'evt-capture-1',
          verifiedAt: '2026-08-18T17:31:00.000Z',
        },
        evidenceReferences: ['payment-provider:capture:evt-capture-1'],
        retryable: false,
      };
    },
  };
  const { store } = createStore();
  const workflow = createFinancePaymentClearanceWorkflow({ integrations, clearanceStore: store });

  await workflow.verifyAndPersist(baseInput({ paymentIntegrationId: 'payment.capture' }));

  assert.equal(capturedRequest?.requestedBy, 'finance_agent');
  assert.equal(capturedRequest?.operation, 'verify_payment');
  assert.equal(capturedRequest?.risk, 'high');
  assert.equal(capturedRequest?.idempotencyKey, 'finance-payment-verification:finance-clearance:workflow:1');
});
