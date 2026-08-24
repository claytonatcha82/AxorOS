import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinanceLedgerEntry } from './finance-ledger-entry.js';
import { createFinanceLedgerReconciliationService } from './finance-ledger-reconciliation-service.js';

function authorityReference(entryType: FinanceLedgerEntry['entryType']): string {
  return `authority:${entryType}`;
}

function evidenceReferences(entryType: FinanceLedgerEntry['entryType']): string[] {
  if (entryType === 'PAYMENT_REQUEST_CREATED') return [authorityReference('PAYMENT_REQUIREMENT_CREATED')];
  if (entryType === 'PAYMENT_PROVIDER_STATE_OBSERVED') return [authorityReference('PAYMENT_REQUEST_CREATED')];
  if (entryType === 'FINANCE_CLEARANCE_CREATED') return [authorityReference('PAYMENT_PROVIDER_STATE_OBSERVED')];
  if (entryType === 'PAYMENT_REQUIREMENT_SATISFIED') return [authorityReference('FINANCE_CLEARANCE_CREATED')];
  return [`evidence:${entryType}`];
}

function entry(entryType: FinanceLedgerEntry['entryType']): FinanceLedgerEntry {
  return {
    entryId: `finance-ledger:${entryType}`,
    entryType,
    commercialRecordReference: 'commercial:reconcile:1',
    authorityType: entryType === 'PAYMENT_REQUIREMENT_CREATED'
      ? 'commercial_payment_requirement'
      : entryType === 'PAYMENT_REQUEST_CREATED'
        ? 'finance_payment_request'
        : entryType === 'FINANCE_CLEARANCE_CREATED'
          ? 'finance_clearance'
          : entryType === 'PAYMENT_REQUIREMENT_SATISFIED'
            ? 'commercial_payment_satisfaction'
            : 'payment_provider_evidence',
    authorityReference: authorityReference(entryType),
    evidenceReferences: evidenceReferences(entryType),
    amountMinor: 12500,
    currency: 'ZAR',
    occurredAt: '2026-08-23T18:00:00.000Z',
    recordedAt: '2026-08-23T18:00:00.000Z',
  };
}

test('Finance ledger reconciliation service reconciles persisted coherent ledger history read-only', async () => {
  let reads = 0;
  const service = createFinanceLedgerReconciliationService({
    ledgerStore: {
      async listByCommercialRecord(reference) {
        reads += 1;
        assert.equal(reference, 'commercial:reconcile:1');
        return [
          entry('PAYMENT_REQUIREMENT_CREATED'),
          entry('PAYMENT_REQUEST_CREATED'),
          entry('PAYMENT_PROVIDER_STATE_OBSERVED'),
          entry('FINANCE_CLEARANCE_CREATED'),
          entry('PAYMENT_REQUIREMENT_SATISFIED'),
        ];
      },
    },
  });

  const result = await service.reconcile(' commercial:reconcile:1 ');
  assert.equal(reads, 1);
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.issues, []);
});

test('Finance ledger reconciliation service surfaces persisted discrepancies without creating authority', async () => {
  const service = createFinanceLedgerReconciliationService({
    ledgerStore: {
      async listByCommercialRecord() {
        return [entry('FINANCE_CLEARANCE_CREATED')];
      },
    },
  });

  const result = await service.reconcile('commercial:reconcile:1');
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'CLEARANCE_WITHOUT_PROVIDER_STATE',
    'CLEARANCE_WITHOUT_SATISFACTION',
  ]);
});

test('Finance ledger reconciliation service rejects an empty commercial record reference before reading storage', async () => {
  let reads = 0;
  const service = createFinanceLedgerReconciliationService({
    ledgerStore: {
      async listByCommercialRecord() {
        reads += 1;
        return [];
      },
    },
  });

  await assert.rejects(service.reconcile('   '), /commercialRecordReference is required/);
  assert.equal(reads, 0);
});
