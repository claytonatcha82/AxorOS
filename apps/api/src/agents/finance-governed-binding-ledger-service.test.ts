import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceGovernedBindingLedgerService } from './finance-governed-binding-ledger-service.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';

const input = {
  commercialRecordReference: 'commercial:binding-ledger:1',
  gate: 'PRODUCTION_START' as const,
  provider: 'paystack',
  providerPaymentReference: 'AXOROS-BINDING-1',
  trustedPaymentWebhookIdempotencyKey: 'payment-webhook:paystack:event-binding-1',
  clearanceId: 'finance-clearance:binding-ledger:1',
  executionId: 'exec:binding-ledger:1',
  correlationId: 'corr:binding-ledger:1',
};

function dependencies() {
  const recorded: RecordFinanceLedgerAuthorityInput[] = [];
  return {
    recorded,
    service: createFinanceGovernedBindingLedgerService({
      bindingService: { async bind() { return { ok: true as const }; } },
      requirementStore: {
        async get() {
          return {
            commercialRecordReference: input.commercialRecordReference,
            gate: input.gate,
            requirementReference: 'requirement:binding-ledger:1',
            requirementType: 'DEPOSIT' as const,
            requiredAmountMinor: 12500,
            currency: 'ZAR',
            status: 'ACTIVE' as const,
          };
        },
      },
      clearanceStore: {
        async get() {
          return {
            clearanceId: input.clearanceId,
            commercialRecordReference: input.commercialRecordReference,
            providerPaymentReference: input.providerPaymentReference,
            state: 'FINANCE_CLEARED' as const,
            reason: 'Verified payment.',
            evidenceReferences: ['payment-provider:paystack:event-binding-1'],
            amountMinor: 12500,
            currency: 'ZAR',
            verifiedAt: '2026-08-23T15:30:00.000Z',
          };
        },
      },
      satisfactionStore: {
        async get() {
          return {
            requirementReference: 'requirement:binding-ledger:1',
            clearanceId: input.clearanceId,
            commercialRecordReference: input.commercialRecordReference,
            gate: input.gate,
            satisfiedAt: '2026-08-23T15:30:00.000Z',
          };
        },
      },
      ledgerRecorder: { async record(entry) { recorded.push(entry); } },
    }),
  };
}

test('governed Finance binding journals persisted clearance and satisfaction authorities', async () => {
  const { service, recorded } = dependencies();
  const result = await service.bind(input);
  assert.deepEqual(result, { ok: true });
  assert.equal(recorded.length, 2);
  assert.equal(recorded[0]?.entryType, 'FINANCE_CLEARANCE_CREATED');
  assert.equal(recorded[0]?.authorityType, 'finance_clearance');
  assert.equal(recorded[0]?.authorityReference, input.clearanceId);
  assert.equal(recorded[1]?.entryType, 'PAYMENT_REQUIREMENT_SATISFIED');
  assert.equal(recorded[1]?.authorityType, 'commercial_payment_satisfaction');
  assert.equal(recorded[1]?.authorityReference, 'requirement:binding-ledger:1');
});

test('governed Finance binding fails closed when persisted satisfaction does not match clearance', async () => {
  const recorded: RecordFinanceLedgerAuthorityInput[] = [];
  const service = createFinanceGovernedBindingLedgerService({
    bindingService: { async bind() { return { ok: true as const }; } },
    requirementStore: {
      async get() {
        return {
          commercialRecordReference: input.commercialRecordReference,
          gate: input.gate,
          requirementReference: 'requirement:binding-ledger:1',
          requirementType: 'DEPOSIT' as const,
          requiredAmountMinor: 12500,
          currency: 'ZAR',
          status: 'ACTIVE' as const,
        };
      },
    },
    clearanceStore: {
      async get() {
        return {
          clearanceId: input.clearanceId,
          commercialRecordReference: input.commercialRecordReference,
          providerPaymentReference: input.providerPaymentReference,
          state: 'FINANCE_CLEARED' as const,
          reason: 'Verified payment.',
          evidenceReferences: ['payment-provider:paystack:event-binding-1'],
          amountMinor: 12500,
          currency: 'ZAR',
          verifiedAt: '2026-08-23T15:30:00.000Z',
        };
      },
    },
    satisfactionStore: {
      async get() {
        return {
          requirementReference: 'requirement:binding-ledger:1',
          clearanceId: 'finance-clearance:other',
          commercialRecordReference: input.commercialRecordReference,
          gate: input.gate,
          satisfiedAt: '2026-08-23T15:30:00.000Z',
        };
      },
    },
    ledgerRecorder: { async record(entry) { recorded.push(entry); } },
  });

  await assert.rejects(service.bind(input), /does not match governed Finance clearance/);
  assert.equal(recorded.length, 0);
});
