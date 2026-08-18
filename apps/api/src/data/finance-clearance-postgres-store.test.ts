import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { FinanceClearancePostgresStore, type PersistedFinanceClearanceDecision } from './finance-clearance-postgres-store.js';

function mockPoolQuery(implementation: (sql: string, values?: readonly unknown[]) => { rowCount: number; rows: unknown[] }): Pick<Pool, 'query'> {
  return { query: (async (sql: string, values?: readonly unknown[]) => implementation(sql, values)) as Pool['query'] };
}

const decision: PersistedFinanceClearanceDecision = {
  clearanceId: 'finance-clearance:test:1', commercialRecordReference: 'commercial:test:1', providerPaymentReference: 'pay_test_1',
  state: 'FINANCE_CLEARED', reason: 'Provider payment evidence matches the governed commercial record.',
  evidenceReferences: ['payment-provider:sandbox:evt_1'], amountMinor: 125000, currency: 'ZAR', verifiedAt: '2026-08-18T08:40:00.000Z',
};

test('trusted Finance clearance decision is persisted with evidence', async () => {
  let values: readonly unknown[] = [];
  const store = new FinanceClearancePostgresStore(mockPoolQuery((_sql, supplied) => { values = supplied ?? []; return { rowCount: 1, rows: [] }; }));
  await store.save(decision);
  assert.equal(values[0], decision.clearanceId);
  assert.equal(values[3], 'FINANCE_CLEARED');
  assert.equal(values[5], JSON.stringify(decision.evidenceReferences));
});

test('trusted Finance clearance decision is loaded from PostgreSQL', async () => {
  const store = new FinanceClearancePostgresStore(mockPoolQuery(() => ({ rowCount: 1, rows: [{
    clearance_id: decision.clearanceId, commercial_record_reference: decision.commercialRecordReference,
    provider_payment_reference: decision.providerPaymentReference, state: decision.state, reason: decision.reason,
    evidence_references: decision.evidenceReferences, amount_minor: '125000', currency: 'ZAR', verified_at: decision.verifiedAt,
  }] })));
  assert.deepEqual(await store.get(decision.clearanceId), decision);
});

test('missing Finance clearance decision returns null', async () => {
  const store = new FinanceClearancePostgresStore(mockPoolQuery(() => ({ rowCount: 0, rows: [] })));
  assert.equal(await store.get('finance-clearance:missing'), null);
});
