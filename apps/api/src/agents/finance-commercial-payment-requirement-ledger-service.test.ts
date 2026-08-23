import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceCommercialPaymentRequirementLedgerService } from './finance-commercial-payment-requirement-ledger-service.js';
import type { PersistedCommercialPaymentRequirement } from '../data/commercial-payment-requirement-postgres-store.js';
import type { RecordFinanceLedgerAuthorityInput } from './finance-ledger-recorder.js';

const requirement: PersistedCommercialPaymentRequirement = {
  commercialRecordReference: 'commercial:requirement-ledger:1',
  gate: 'PRODUCTION_START',
  requirementReference: 'requirement:requirement-ledger:1',
  requirementType: 'DEPOSIT',
  requiredAmountMinor: 12500,
  currency: 'ZAR',
  status: 'ACTIVE',
};

test('Finance payment requirement ledger service journals persisted requirement authority', async () => {
  const recorded: RecordFinanceLedgerAuthorityInput[] = [];
  const service = createFinanceCommercialPaymentRequirementLedgerService({
    requirementStore: {
      async save() { return 'accepted'; },
      async get() { return requirement; },
    },
    ledgerRecorder: { async record(input) { recorded.push(input); } },
  });

  const persistence = await service.save(requirement);
  assert.equal(persistence, 'accepted');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.entryType, 'PAYMENT_REQUIREMENT_CREATED');
  assert.equal(recorded[0]?.authorityType, 'commercial_payment_requirement');
  assert.equal(recorded[0]?.authorityReference, requirement.requirementReference);
  assert.equal(recorded[0]?.amountMinor, 12500);
  assert.equal(recorded[0]?.currency, 'ZAR');
});

test('Finance payment requirement ledger service fails closed when reloaded authority differs', async () => {
  const recorded: RecordFinanceLedgerAuthorityInput[] = [];
  const service = createFinanceCommercialPaymentRequirementLedgerService({
    requirementStore: {
      async save() { return 'accepted'; },
      async get() { return { ...requirement, requiredAmountMinor: 9999 }; },
    },
    ledgerRecorder: { async record(input) { recorded.push(input); } },
  });

  await assert.rejects(service.save(requirement), /does not match submitted Finance authority/);
  assert.equal(recorded.length, 0);
});
