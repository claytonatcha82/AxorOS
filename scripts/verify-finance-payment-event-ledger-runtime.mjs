import pg from 'pg';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-payment-event-ledger-runtime-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:event-ledger-runtime:${suffix}`;
const providerPaymentReference = `AXOROS-EVENT-${suffix}`;
const pendingEventReference = `event-pending:${suffix}`;
const disputedEventReference = `event-disputed:${suffix}`;
const occurredAt = new Date().toISOString();

const runtime = createFinancePaymentRuntime({
  pool,
  integrations: new IntegrationRegistry(),
  mode: 'sandbox',
});

const pending = {
  provider: 'paystack',
  providerEventReference: pendingEventReference,
  providerPaymentReference,
  eventType: 'payment_pending',
  commercialRecordReference,
  amountMinor: 12500,
  currency: 'ZAR',
  occurredAt,
  signatureVerified: true,
};

const disputed = {
  provider: 'paystack',
  providerEventReference: disputedEventReference,
  providerPaymentReference,
  eventType: 'payment_disputed',
  commercialRecordReference,
  amountMinor: 12500,
  currency: 'ZAR',
  occurredAt: new Date(Date.parse(occurredAt) + 1000).toISOString(),
  signatureVerified: true,
};

async function ledgerRows() {
  const result = await pool.query(
    `select entry_id, entry_type, authority_reference, amount_minor, currency, occurred_at
       from finance.ledger_entries
      where commercial_record_reference = $1
      order by occurred_at, entry_id`,
    [commercialRecordReference],
  );
  return result.rows;
}

async function cleanup() {
  await pool.query('delete from finance.ledger_entries where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.payment_current_state where provider = $1 and provider_payment_reference = $2', ['paystack', providerPaymentReference]);
  await pool.query('delete from finance.payment_webhook_events where provider = $1 and provider_payment_reference = $2', ['paystack', providerPaymentReference]).catch(() => undefined);
  await pool.query('delete from finance.payment_webhook_evidence where provider = $1 and provider_payment_reference = $2', ['paystack', providerPaymentReference]).catch(() => undefined);
}

try {
  const first = await runtime.eventWorkflow.ingest(pending);
  if (first.webhookPersistence !== 'accepted') throw new Error('Initial pending provider event was not accepted.');

  const firstRows = await ledgerRows();
  if (firstRows.length !== 1) throw new Error(`Expected one ledger entry after initial provider event, got ${firstRows.length}.`);
  if (firstRows[0].entry_type !== 'PAYMENT_PROVIDER_STATE_OBSERVED') throw new Error('Initial provider event was not journaled as PAYMENT_PROVIDER_STATE_OBSERVED.');
  if (firstRows[0].authority_reference !== `payment-provider:paystack:${pendingEventReference}`) throw new Error('Initial provider ledger authority reference mismatch.');

  const replay = await runtime.eventWorkflow.ingest(pending);
  if (replay.webhookPersistence !== 'duplicate') throw new Error('Provider event replay was not identified as duplicate.');

  const replayRows = await ledgerRows();
  if (replayRows.length !== 1) throw new Error(`Provider event replay created duplicate ledger history; found ${replayRows.length} entries.`);
  if (replayRows[0].entry_id !== firstRows[0].entry_id) throw new Error('Provider event replay changed immutable ledger identity.');

  const adverse = await runtime.eventWorkflow.ingest(disputed);
  if (adverse.webhookPersistence !== 'accepted') throw new Error('Disputed provider event was not accepted as new evidence.');

  const finalRows = await ledgerRows();
  if (finalRows.length !== 2) throw new Error(`Expected two immutable ledger entries after adverse lifecycle evidence, got ${finalRows.length}.`);
  const normalEntry = finalRows.find((row) => row.entry_type === 'PAYMENT_PROVIDER_STATE_OBSERVED');
  const adverseEntry = finalRows.find((row) => row.entry_type === 'PAYMENT_ADVERSE_EVENT_OBSERVED');
  if (!normalEntry) throw new Error('Original provider-state ledger entry disappeared after adverse event.');
  if (!adverseEntry) throw new Error('Adverse provider event was not journaled separately.');
  if (normalEntry.entry_id !== firstRows[0].entry_id) throw new Error('Adverse event rewrote original provider-state ledger identity.');
  if (adverseEntry.authority_reference !== `payment-provider:paystack:${disputedEventReference}`) throw new Error('Adverse ledger authority reference mismatch.');
  if (Number(adverseEntry.amount_minor) !== 12500 || adverseEntry.currency !== 'ZAR') throw new Error('Adverse ledger amount or currency mismatch.');

  console.log('PASS  Governed Finance runtime journals trusted provider state once, treats replay as idempotent without duplicate ledger history, and preserves later disputed payment evidence as a separate immutable adverse event without rewriting the original provider-state entry.');
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
