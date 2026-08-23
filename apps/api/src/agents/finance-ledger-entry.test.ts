import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceLedgerEntry, validateFinanceLedgerEntry } from './finance-ledger-entry.js';

test('Finance ledger entry preserves trusted authority and monetary values', () => {
  const entry = createFinanceLedgerEntry({
    entryId: 'finance-ledger:1',
    entryType: 'PAYMENT_PROVIDER_STATE_OBSERVED',
    commercialRecordReference: 'commercial:1',
    authorityType: 'payment_provider_evidence',
    authorityReference: 'payment-provider:paystack:event:1',
    evidenceReferences: ['payment-provider:paystack:event:1'],
    amountMinor: 12500,
    currency: 'ZAR',
    occurredAt: '2026-08-23T13:00:00.000Z',
    recordedAt: '2026-08-23T13:00:01.000Z',
  });

  assert.equal(entry.amountMinor, 12500);
  assert.equal(entry.currency, 'ZAR');
  assert.equal(entry.authorityType, 'payment_provider_evidence');
  assert.deepEqual(entry.evidenceReferences, ['payment-provider:paystack:event:1']);
  assert.deepEqual(validateFinanceLedgerEntry(entry), []);
});

test('Finance ledger entry rejects monetary amount without currency', () => {
  assert.throws(
    () => createFinanceLedgerEntry({
      entryId: 'finance-ledger:2',
      entryType: 'PAYMENT_REQUIREMENT_CREATED',
      commercialRecordReference: 'commercial:2',
      authorityType: 'commercial_payment_requirement',
      authorityReference: 'requirement:2',
      evidenceReferences: ['requirement:2'],
      amountMinor: 10000,
      occurredAt: '2026-08-23T13:00:00.000Z',
    }),
    /amountMinor and currency must be supplied together/,
  );
});

test('Finance ledger entry rejects missing evidence authority', () => {
  assert.throws(
    () => createFinanceLedgerEntry({
      entryId: 'finance-ledger:3',
      entryType: 'FINANCE_CLEARANCE_CREATED',
      commercialRecordReference: 'commercial:3',
      authorityType: 'finance_clearance',
      authorityReference: 'finance-clearance:3',
      evidenceReferences: [],
      occurredAt: '2026-08-23T13:00:00.000Z',
    }),
    /at least one evidence reference is required/,
  );
});
