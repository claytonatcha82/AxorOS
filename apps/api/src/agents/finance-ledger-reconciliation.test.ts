import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileFinanceLedger } from './finance-ledger-reconciliation.js';
import type { FinanceLedgerEntry, FinanceLedgerEntryType } from './finance-ledger-entry.js';

const commercialRecordReference = 'commercial:reconcile:1';

function entry(
  entryType: FinanceLedgerEntryType,
  overrides: Partial<Pick<FinanceLedgerEntry, 'amountMinor' | 'currency'>> = {},
): FinanceLedgerEntry {
  return {
    entryId: `finance-ledger:${entryType}`,
    entryType,
    commercialRecordReference,
    authorityType: entryType === 'PAYMENT_REQUIREMENT_CREATED'
      ? 'commercial_payment_requirement'
      : entryType === 'PAYMENT_REQUEST_CREATED'
        ? 'finance_payment_request'
        : entryType === 'FINANCE_CLEARANCE_CREATED'
          ? 'finance_clearance'
          : entryType === 'PAYMENT_REQUIREMENT_SATISFIED'
            ? 'commercial_payment_satisfaction'
            : 'payment_provider_evidence',
    authorityReference: `authority:${entryType}`,
    evidenceReferences: [`evidence:${entryType}`],
    amountMinor: overrides.amountMinor ?? 12500,
    currency: overrides.currency ?? 'ZAR',
    occurredAt: '2026-08-23T18:00:00.000Z',
    recordedAt: '2026-08-23T18:00:00.000Z',
  };
}

test('Finance ledger reconciliation accepts a coherent governed lifecycle including later adverse evidence', () => {
  const result = reconcileFinanceLedger(commercialRecordReference, [
    entry('PAYMENT_REQUIREMENT_CREATED'),
    entry('PAYMENT_REQUEST_CREATED'),
    entry('PAYMENT_PROVIDER_STATE_OBSERVED'),
    entry('FINANCE_CLEARANCE_CREATED'),
    entry('PAYMENT_REQUIREMENT_SATISFIED'),
    entry('PAYMENT_ADVERSE_EVENT_OBSERVED'),
  ]);

  assert.equal(result.reconciled, true);
  assert.deepEqual(result.issues, []);
});

test('Finance ledger reconciliation detects partial or impossible financial history without mutating it', () => {
  const result = reconcileFinanceLedger(commercialRecordReference, [
    entry('PAYMENT_REQUEST_CREATED'),
    entry('FINANCE_CLEARANCE_CREATED'),
  ]);

  assert.equal(result.reconciled, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'PAYMENT_REQUEST_WITHOUT_REQUIREMENT',
    'CLEARANCE_WITHOUT_PROVIDER_STATE',
    'CLEARANCE_WITHOUT_SATISFACTION',
  ]);
});

test('Finance ledger reconciliation detects amount disagreement across an otherwise complete lifecycle', () => {
  const result = reconcileFinanceLedger(commercialRecordReference, [
    entry('PAYMENT_REQUIREMENT_CREATED', { amountMinor: 12500 }),
    entry('PAYMENT_REQUEST_CREATED', { amountMinor: 12500 }),
    entry('PAYMENT_PROVIDER_STATE_OBSERVED', { amountMinor: 12000 }),
    entry('FINANCE_CLEARANCE_CREATED', { amountMinor: 12500 }),
    entry('PAYMENT_REQUIREMENT_SATISFIED', { amountMinor: 12500 }),
  ]);

  assert.equal(result.reconciled, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ['AMOUNT_MISMATCH']);
});

test('Finance ledger reconciliation detects currency disagreement across an otherwise complete lifecycle', () => {
  const result = reconcileFinanceLedger(commercialRecordReference, [
    entry('PAYMENT_REQUIREMENT_CREATED', { currency: 'ZAR' }),
    entry('PAYMENT_REQUEST_CREATED', { currency: 'ZAR' }),
    entry('PAYMENT_PROVIDER_STATE_OBSERVED', { currency: 'USD' }),
    entry('FINANCE_CLEARANCE_CREATED', { currency: 'ZAR' }),
    entry('PAYMENT_REQUIREMENT_SATISFIED', { currency: 'ZAR' }),
  ]);

  assert.equal(result.reconciled, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ['CURRENCY_MISMATCH']);
});
