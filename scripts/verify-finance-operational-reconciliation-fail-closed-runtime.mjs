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
  application_name: 'axoros-finance-operational-reconciliation-fail-closed-verifier',
});
const runtime = createFinancePaymentRuntime({
  pool,
  integrations: new IntegrationRegistry(),
  mode: 'sandbox',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:finance-operational-reconciliation:verify:${suffix}`;
const gate = 'PRODUCTION_START';
const provider = 'paystack';
const providerPaymentReference = `payment:${suffix}`;
const now = new Date().toISOString();

async function cleanup() {
  await pool.query('delete from finance.ledger_entries where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1', [commercialRecordReference]).catch(() => undefined);
}

try {
  await runtime.ledgerRecorder.record({
    entryType: 'PAYMENT_REQUEST_CREATED',
    authorityType: 'finance_payment_request',
    authorityReference: `payment-request:${suffix}`,
    evidenceReferences: [`payment-request:${suffix}`],
    commercialRecordReference,
    amountMinor: 27500,
    currency: 'ZAR',
    occurredAt: now,
  });

  const before = await runtime.ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.equal(before.length, 1);

  const result = await runtime.governedOperationalRuntime.assess({
    commercialRecordReference,
    gate,
    provider,
    providerPaymentReference,
  });

  assert.equal(result.reconciliation.reconciled, false);
  assert.equal(result.decision.state, 'MANUAL_REVIEW');
  assert.equal(result.decision.advisoryModelAllowed, true);
  assert.match(result.decision.reason, /PAYMENT_REQUEST_WITHOUT_REQUIREMENT/);
  assert.match(result.auditEventReference, /^workflow-event:/);

  const after = await runtime.ledgerStore.listByCommercialRecord(commercialRecordReference);
  assert.deepEqual(after, before);

  console.log('PASS  Finance operational runtime fails closed to MANUAL_REVIEW on unreconciled persisted ledger history, preserves reconciliation evidence in the audited assessment, and performs no ledger mutation.');
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
