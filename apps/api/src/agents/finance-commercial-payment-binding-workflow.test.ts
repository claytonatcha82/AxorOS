import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersistedCommercialPaymentRequirement } from '../data/commercial-payment-requirement-postgres-store.js';
import type { PersistedCommercialPaymentSatisfaction } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { PaymentWebhookEvidence } from '../integrations/payment-webhook-evidence.js';
import type { VerifyFinancePaymentInput, VerifyFinancePaymentResult } from './finance-payment-clearance-workflow.js';
import { createFinanceCommercialPaymentBindingWorkflow } from './finance-commercial-payment-binding-workflow.js';

const requirement: PersistedCommercialPaymentRequirement = {
  commercialRecordReference: 'commercial:binding:1',
  gate: 'PRODUCTION_START',
  requirementReference: 'payment-requirement:binding:1',
  requirementType: 'DEPOSIT',
  requiredAmountMinor: 500000,
  currency: 'ZAR',
  status: 'ACTIVE',
};

const evidence: PaymentWebhookEvidence = {
  idempotencyKey: 'payment-webhook:paystack:charge.success:binding:1',
  provider: 'paystack',
  providerEventReference: 'charge.success:binding:1',
  providerPaymentReference: 'AXOROS-BINDING-1',
  eventType: 'payment_paid',
  commercialRecordReference: 'commercial:binding:1',
  amountMinor: 500000,
  currency: 'ZAR',
  occurredAt: '2026-08-22T18:00:00.000Z',
  evidenceReference: 'payment-provider:paystack:charge.success:binding:1',
};

function clearedResult(): VerifyFinancePaymentResult {
  return {
    decision: {
      clearanceId: 'finance-clearance:binding:1',
      commercialRecordReference: requirement.commercialRecordReference,
      providerPaymentReference: evidence.providerPaymentReference,
      state: 'FINANCE_CLEARED',
      reason: 'Provider payment evidence matches the governed commercial record.',
      evidenceReferences: [evidence.evidenceReference],
      amountMinor: requirement.requiredAmountMinor,
      currency: requirement.currency,
      verifiedAt: '2026-08-22T18:01:00.000Z',
    },
    persistence: 'accepted',
  };
}

function createHarness(options?: {
  storedRequirement?: PersistedCommercialPaymentRequirement | null;
  storedEvidence?: PaymentWebhookEvidence | null;
  clearance?: VerifyFinancePaymentResult;
}) {
  const satisfactions: PersistedCommercialPaymentSatisfaction[] = [];
  const clearanceInputs: VerifyFinancePaymentInput[] = [];
  const storedRequirement = options?.storedRequirement === undefined ? requirement : options.storedRequirement;
  const storedEvidence = options?.storedEvidence === undefined ? evidence : options.storedEvidence;
  const clearance = options?.clearance ?? clearedResult();

  const workflow = createFinanceCommercialPaymentBindingWorkflow({
    requirementStore: {
      async get() {
        return storedRequirement;
      },
    },
    satisfactionStore: {
      async save(satisfaction) {
        satisfactions.push(satisfaction);
        return 'accepted' as const;
      },
    },
    paymentWebhookEvidenceStore: {
      async get() {
        return storedEvidence;
      },
    },
    clearanceWorkflow: {
      async verifyAndPersist(input) {
        clearanceInputs.push(input as VerifyFinancePaymentInput);
        return clearance;
      },
    },
  });

  return { workflow, satisfactions, clearanceInputs };
}

function input() {
  return {
    commercialRecordReference: requirement.commercialRecordReference,
    gate: requirement.gate,
    trustedPaymentWebhookIdempotencyKey: evidence.idempotencyKey,
    clearanceId: 'finance-clearance:binding:1',
    executionId: 'finance-binding-execution:1',
    correlationId: 'finance-binding-correlation:1',
    paymentIntegrationId: 'payment.paystack',
    mode: 'sandbox' as const,
  };
}

test('binds provider verification to the authoritative commercial payment requirement before satisfying the gate', async () => {
  const { workflow, satisfactions, clearanceInputs } = createHarness();
  const result = await workflow.bindAndSatisfy(input());

  assert.equal(result.clearance.decision.state, 'FINANCE_CLEARED');
  assert.equal(result.satisfactionPersistence, 'accepted');
  assert.equal(clearanceInputs.length, 1);
  assert.deepEqual(clearanceInputs[0]?.expected, {
    providerPaymentReference: evidence.providerPaymentReference,
    expectedAmountMinor: requirement.requiredAmountMinor,
    currency: requirement.currency,
    commercialRecordReference: requirement.commercialRecordReference,
  });
  assert.equal(clearanceInputs[0]?.trustedPaymentWebhookIdempotencyKey, evidence.idempotencyKey);
  assert.deepEqual(satisfactions, [{
    requirementReference: requirement.requirementReference,
    clearanceId: 'finance-clearance:binding:1',
    commercialRecordReference: requirement.commercialRecordReference,
    gate: requirement.gate,
    satisfiedAt: '2026-08-22T18:01:00.000Z',
  }]);
});

test('rejects a paid webhook whose amount does not satisfy the governed requirement', async () => {
  const mismatchedEvidence = { ...evidence, amountMinor: 100 };
  const { workflow, satisfactions, clearanceInputs } = createHarness({ storedEvidence: mismatchedEvidence });

  await assert.rejects(
    () => workflow.bindAndSatisfy(input()),
    /amount does not satisfy the commercial payment requirement/,
  );
  assert.equal(clearanceInputs.length, 0);
  assert.equal(satisfactions.length, 0);
});

test('rejects a non-active commercial payment requirement', async () => {
  const { workflow, satisfactions, clearanceInputs } = createHarness({
    storedRequirement: { ...requirement, status: 'SATISFIED' },
  });

  await assert.rejects(() => workflow.bindAndSatisfy(input()), /is not active/);
  assert.equal(clearanceInputs.length, 0);
  assert.equal(satisfactions.length, 0);
});

test('does not persist requirement satisfaction when independent Finance verification remains pending', async () => {
  const pending = clearedResult();
  pending.decision = {
    ...pending.decision,
    state: 'FINANCE_PENDING',
    reason: 'Payment awaiting verification.',
  };
  const { workflow, satisfactions } = createHarness({ clearance: pending });

  const result = await workflow.bindAndSatisfy(input());

  assert.equal(result.clearance.decision.state, 'FINANCE_PENDING');
  assert.equal(result.satisfactionPersistence, 'not_satisfied');
  assert.equal(satisfactions.length, 0);
});
