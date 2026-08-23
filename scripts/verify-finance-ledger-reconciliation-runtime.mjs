import assert from 'node:assert/strict';
import pg from 'pg';
import { createFinanceLedgerEntry } from '../apps/api/dist/agents/finance-ledger-entry.js';
import { createFinanceLedgerReconciliationService } from '../apps/api/dist/agents/finance-ledger-reconciliation-service.js';
import { FinanceLedgerPostgresStore } from '../apps/api/dist/data/finance-ledger-postgres-store.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-ledger-reconciliation-verifier',
});
const ledgerStore = new FinanceLedgerPostgresStore(pool);
const reconciliationService = createFinanceLedgerReconciliationService({ ledgerStore });
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:finance-ledger-reconciliation:verify:${suffix}`;
const entryId = `finance-ledger:reconciliation:verify:${suffix}`;
const authorityReference = `payment-request:reconciliation:verify:${suffix}`;
const now = new Date().toISOString();

const incompletePaymentRequest = createFinanceLedgerEntry({
  entryId,
  entryType: 'PAYMENT_REQUEST_CREATED',
  commercialRecordReference,
  authorityType: 'payment_request',
  authorityReference,
  evidenceReferences: [authorityReference],
  amountMinor: 27500,
  currency: 'ZAR',
  occurredAt: now,
  recordedAt: now,
});

async function cleanup() {
  await pool.query(
    'delete from finance.ledger_entries where commercial_record_reference = $1',
    [commercialRecordReference],
  );
}

try {
  await ledgerStore.save(incompletePaymentRequest);

  const before = await ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.equal(before.length, 1);
  assert.deepEqual(before[0], incompletePaymentRequest);

  const result = await reconciliationService.reconcile(commercialRecordReference);
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.entryTypes, ['PAYMENT_REQUEST_CREATED']);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ['PAYMENT_REQUEST_WITHOUT_REQUIREMENT'],
  );

  const after = await ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.deepEqual(after, before);

  const persistedCount = await pool.query(
    `select count(*)::int as count
       from finance.ledger_entries
      where commercial_record_reference = $1`,
    [commercialRecordReference],
  );
  assert.equal(persistedCount.rows[0]?.count, 1);

  console.log('PASS  Finance runtime reconciliation detects an incomplete persisted payment chain and performs no ledger writes or mutations.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    console.error(`WARN  verifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  await pool.end().catch(() => undefined);
}
