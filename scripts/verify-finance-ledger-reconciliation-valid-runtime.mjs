import assert from 'node:assert/strict';
import pg from 'pg';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
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
  application_name: 'axoros-finance-ledger-valid-reconciliation-verifier',
});
const runtime = createFinancePaymentRuntime({
  pool,
  integrations: new IntegrationRegistry(),
  mode: 'sandbox',
});
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:finance-ledger-valid-reconciliation:verify:${suffix}`;
const amountMinor = 41500;
const currency = 'ZAR';
const now = new Date().toISOString();

const authorities = [
  {
    entryType: 'PAYMENT_REQUIREMENT_CREATED',
    authorityType: 'commercial_payment_requirement',
    authorityReference: `requirement:${suffix}`,
    evidenceReferences: [`requirement:${suffix}`],
  },
  {
    entryType: 'PAYMENT_REQUEST_CREATED',
    authorityType: 'finance_payment_request',
    authorityReference: `payment-request:${suffix}`,
    evidenceReferences: [`payment-request:${suffix}`],
  },
  {
    entryType: 'PAYMENT_PROVIDER_STATE_OBSERVED',
    authorityType: 'payment_provider_evidence',
    authorityReference: `payment-provider:paystack:${suffix}`,
    evidenceReferences: [`payment-provider:paystack:${suffix}`],
  },
  {
    entryType: 'FINANCE_CLEARANCE_CREATED',
    authorityType: 'finance_clearance',
    authorityReference: `finance-clearance:${suffix}`,
    evidenceReferences: [`finance-clearance:${suffix}`, `payment-provider:paystack:${suffix}`],
  },
  {
    entryType: 'PAYMENT_REQUIREMENT_SATISFIED',
    authorityType: 'commercial_payment_satisfaction',
    authorityReference: `payment-satisfaction:${suffix}`,
    evidenceReferences: [`payment-satisfaction:${suffix}`, `finance-clearance:${suffix}`],
  },
];

async function cleanup() {
  await pool.query(
    'delete from finance.ledger_entries where commercial_record_reference = $1',
    [commercialRecordReference],
  );
}

try {
  for (const authority of authorities) {
    await runtime.ledgerRecorder.record({
      ...authority,
      commercialRecordReference,
      amountMinor,
      currency,
      occurredAt: now,
    });
  }

  const before = await runtime.ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.equal(before.length, 5);

  const result = await runtime.ledgerReconciliationService.reconcile(commercialRecordReference);
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.entryTypes, authorities.map((authority) => authority.entryType));

  const after = await runtime.ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.deepEqual(after, before);

  const persistedCount = await pool.query(
    `select count(*)::int as count
       from finance.ledger_entries
      where commercial_record_reference = $1`,
    [commercialRecordReference],
  );
  assert.equal(persistedCount.rows[0]?.count, 5);

  console.log('PASS  Finance payment runtime reconciles a complete persisted payment lifecycle cleanly and performs no ledger writes or mutations during reconciliation.');
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
