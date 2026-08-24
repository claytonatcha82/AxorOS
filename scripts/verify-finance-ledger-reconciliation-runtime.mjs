import assert from 'node:assert/strict';
import pg from 'pg';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { DeterministicPaymentIntegration } from '../apps/api/dist/integrations/deterministic-payment-integration.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

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
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:finance-ledger-reconciliation:verify:${suffix}`;
const authorityReference = `payment-request:reconciliation:verify:${suffix}`;
const now = new Date().toISOString();

async function cleanup() {
  await pool.query(
    'delete from finance.ledger_entries where commercial_record_reference = $1',
    [commercialRecordReference],
  );
}

try {
  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicPaymentIntegration());
  const runtime = createFinancePaymentRuntime({ pool, integrations });

  const recorded = await runtime.ledgerRecorder.record({
    entryType: 'PAYMENT_REQUEST_CREATED',
    commercialRecordReference,
    authorityType: 'finance_payment_request',
    authorityReference,
    evidenceReferences: [authorityReference],
    amountMinor: 27500,
    currency: 'ZAR',
    occurredAt: now,
  });
  assert.equal(recorded.persistence, 'accepted');

  const before = await runtime.ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.equal(before.length, 1);
  assert.deepEqual(before[0], recorded.entry);

  const result = await runtime.ledgerReconciliationService.reconcile(commercialRecordReference);
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.entryTypes, ['PAYMENT_REQUEST_CREATED']);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ['PAYMENT_REQUEST_WITHOUT_REQUIREMENT'],
  );

  const after = await runtime.ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.deepEqual(after, before);

  const persistedCount = await pool.query(
    `select count(*)::int as count
       from finance.ledger_entries
      where commercial_record_reference = $1`,
    [commercialRecordReference],
  );
  assert.equal(persistedCount.rows[0]?.count, 1);

  console.log('PASS  Finance payment runtime exposes persisted ledger reconciliation, detects an incomplete payment-request chain, and performs no ledger writes or mutations during reconciliation.');
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
