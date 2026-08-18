import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  CommercialPaymentRequirementIntegrityConflictError,
  CommercialPaymentRequirementPostgresStore,
  type PersistedCommercialPaymentRequirement,
} from './commercial-payment-requirement-postgres-store.js';

const requirement: PersistedCommercialPaymentRequirement = {
  commercialRecordReference: 'commercial:test:production-start',
  gate: 'PRODUCTION_START',
  requirementReference: 'requirement:deposit:test:1',
  requirementType: 'DEPOSIT',
  requiredAmountMinor: 50000,
  currency: 'ZAR',
  status: 'ACTIVE',
};

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    commercial_record_reference: requirement.commercialRecordReference,
    gate: requirement.gate,
    requirement_reference: requirement.requirementReference,
    requirement_type: requirement.requirementType,
    required_amount_minor: String(requirement.requiredAmountMinor),
    currency: requirement.currency,
    status: requirement.status,
    ...overrides,
  };
}

function mockPoolQuery(
  implementation: (sql: string, values?: readonly unknown[]) => { rowCount: number; rows: unknown[] },
): Pick<Pool, 'query'> {
  return {
    query: (async (sql: string, values?: readonly unknown[]) => implementation(sql, values)) as Pool['query'],
  };
}

test('commercial payment requirement store accepts a new governed requirement', async () => {
  const store = new CommercialPaymentRequirementPostgresStore(mockPoolQuery(() => ({
    rowCount: 1,
    rows: [{ commercial_record_reference: requirement.commercialRecordReference }],
  })));

  assert.equal(await store.save(requirement), 'accepted');
});

test('exact commercial payment requirement replay is idempotent', async () => {
  let calls = 0;
  const store = new CommercialPaymentRequirementPostgresStore(mockPoolQuery(() => {
    calls += 1;
    return calls === 1
      ? { rowCount: 0, rows: [] }
      : { rowCount: 1, rows: [row()] };
  }));

  assert.equal(await store.save(requirement), 'duplicate');
});

test('same commercial gate cannot be silently replaced with a different amount', async () => {
  let calls = 0;
  const store = new CommercialPaymentRequirementPostgresStore(mockPoolQuery(() => {
    calls += 1;
    return calls === 1
      ? { rowCount: 0, rows: [] }
      : { rowCount: 1, rows: [row({ required_amount_minor: '99999' })] };
  }));

  await assert.rejects(() => store.save(requirement), CommercialPaymentRequirementIntegrityConflictError);
});

test('commercial payment requirement can be loaded for a specific gate', async () => {
  const store = new CommercialPaymentRequirementPostgresStore(mockPoolQuery(() => ({
    rowCount: 1,
    rows: [row()],
  })));

  assert.deepEqual(await store.get(requirement.commercialRecordReference, 'PRODUCTION_START'), requirement);
});
