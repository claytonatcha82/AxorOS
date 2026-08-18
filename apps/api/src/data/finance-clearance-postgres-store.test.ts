import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  FinanceClearanceIntegrityConflictError,
  FinanceClearancePostgresStore,
  type PersistedFinanceClearanceDecision,
} from './finance-clearance-postgres-store.js';

function mockPoolQuery(implementation: (sql: string, values?: readonly unknown[]) => { rowCount: number; rows: unknown[] }): Pick<Pool, 'query'> {
  return { query: (async (sql: string, values?: readonly unknown[]) => implementation(sql, values)) as Pool['query'] };
}

const decision: PersistedFinanceClearanceDecision = {
  clearanceId: 'finance-clearance:test:1', commercialRecordReference: 'commercial:test:1', providerPaymentReference: 'pay_test_1',
  state: 'FINANCE_CLEARED', reason: 'Provider payment evidence matches the governed commercial record.',
  evidenceReferences: ['payment-provider:sandbox:evt_1'], amountMinor: 125000, currency: 'ZAR', verifiedAt: '2026-08-18T08:40:00.000Z',
};

function persistedRow(value: PersistedFinanceClearanceDecision): Record<string, unknown> {
  return {
    clearance_id: value.clearanceId,
    commercial_record_reference: value.commercialRecordReference,
    provider_payment_reference: value.providerPaymentReference,
    state: value.state,
    reason: value.reason,
    evidence_references: value.evidenceReferences,
    amount_minor: String(value.amountMinor),
    currency: value.currency,
    verified_at: value.verifiedAt,
  };
}

test('trusted Finance clearance decision is persisted with evidence', async () => {
  let values: readonly unknown[] = [];
  const store = new FinanceClearancePostgresStore(mockPoolQuery((_sql, supplied) => { values = supplied ?? []; return { rowCount: 1, rows: [{ clearance_id: decision.clearanceId }] }; }));
  assert.equal(await store.save(decision), 'accepted');
  assert.equal(values[0], decision.clearanceId);
  assert.equal(values[3], 'FINANCE_CLEARED');
  assert.equal(values[5], JSON.stringify(decision.evidenceReferences));
});

test('exact Finance clearance replay is treated as an idempotent duplicate', async () => {
  let calls = 0;
  const store = new FinanceClearancePostgresStore(mockPoolQuery(() => {
    calls += 1;
    if (calls === 1) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [persistedRow(decision)] };
  }));
  assert.equal(await store.save(decision), 'duplicate');
});

test('conflicting reuse of a Finance clearance ID is rejected', async () => {
  let calls = 0;
  const conflicting = { ...decision, amountMinor: decision.amountMinor + 1 };
  const store = new FinanceClearancePostgresStore(mockPoolQuery(() => {
    calls += 1;
    if (calls === 1) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [persistedRow(decision)] };
  }));
  await assert.rejects(() => store.save(conflicting), FinanceClearanceIntegrityConflictError);
});

test('insert conflict without an authoritative Finance clearance row is rejected', async () => {
  const store = new FinanceClearancePostgresStore(mockPoolQuery(() => ({ rowCount: 0, rows: [] })));
  await assert.rejects(() => store.save(decision), FinanceClearanceIntegrityConflictError);
});

test('trusted Finance clearance decision is loaded from PostgreSQL', async () => {
  const store = new FinanceClearancePostgresStore(mockPoolQuery(() => ({ rowCount: 1, rows: [persistedRow(decision)] })));
  assert.deepEqual(await store.get(decision.clearanceId), decision);
});

test('missing Finance clearance decision returns null', async () => {
  const store = new FinanceClearancePostgresStore(mockPoolQuery(() => ({ rowCount: 0, rows: [] })));
  assert.equal(await store.get('finance-clearance:missing'), null);
});
