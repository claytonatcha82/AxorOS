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
  application_name: 'axoros-finance-binding-ledger-runtime-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:binding-ledger-runtime:${suffix}`;
const requirementReference = `requirement:binding-ledger-runtime:${suffix}`;
const providerPaymentReference = `AXOROS-BINDING-${suffix}`;
const providerEventReference = `event-binding-ledger:${suffix}`;
const webhookIdempotencyKey = `payment-webhook:paystack:${providerEventReference}`;
const clearanceId = `finance-clearance:binding-ledger-runtime:${suffix}`;
const occurredAt = new Date().toISOString();
let verificationCalls = 0;

const integrations = new IntegrationRegistry();
integrations.register({
  integrationId: 'payment.sandbox',
  kind: 'payment',
  provider: 'sandbox',
  supportedModes: ['sandbox'],
  supportedOperations: ['verify_payment'],
  async execute(request) {
    verificationCalls += 1;
    const input = request.input;
    return {
      integrationId: 'payment.sandbox',
      operation: request.operation,
      provider: 'sandbox',
      mode: request.mode,
      status: 'succeeded',
      output: {
        providerPaymentReference: input.providerPaymentReference,
        commercialRecordReference: input.commercialRecordReference,
        verificationStatus: 'verified_paid',
        amountMinor: input.expectedAmountMinor,
        currency: input.currency,
        providerEventReference,
        verifiedAt: occurredAt,
      },
      externalReference: input.providerPaymentReference,
      evidenceReferences: [`payment-sandbox:${providerEventReference}`],
      retryable: false,
    };
  },
});

const runtime = createFinancePaymentRuntime({
  pool,
  integrations,
  paymentIntegrationId: 'payment.sandbox',
  mode: 'sandbox',
});

async function cleanup() {
  await pool.query('delete from finance.ledger_entries where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.commercial_payment_satisfactions where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.clearance_decisions where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.payment_current_state where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.payment_webhook_events where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1', [commercialRecordReference]);
}

try {
  const requirementPersistence = await runtime.requirementStore.save({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 12500,
    currency: 'ZAR',
    status: 'ACTIVE',
  });
  if (requirementPersistence !== 'accepted') throw new Error('Commercial payment requirement was not newly accepted.');

  const eventResult = await runtime.eventWorkflow.ingest({
    provider: 'paystack',
    providerEventReference,
    providerPaymentReference,
    eventType: 'payment_paid',
    commercialRecordReference,
    amountMinor: 12500,
    currency: 'ZAR',
    occurredAt,
    signatureVerified: true,
  });
  if (eventResult.currentStatePersistence !== 'accepted') throw new Error('Trusted paid provider state was not persisted.');

  const before = await runtime.governedOperationalCoordinator.assess({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    provider: 'paystack',
    providerPaymentReference,
  });
  if (before.state !== 'READY_TO_BIND_REQUIREMENT') {
    throw new Error(`Expected READY_TO_BIND_REQUIREMENT before binding, received ${before.state}.`);
  }

  const first = await runtime.governedBindingService.bind({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    provider: 'paystack',
    providerPaymentReference,
    trustedPaymentWebhookIdempotencyKey: webhookIdempotencyKey,
    clearanceId,
    executionId: `exec:binding-ledger-runtime:${suffix}`,
    correlationId: `corr:binding-ledger-runtime:${suffix}`,
  });
  if (first.after.state !== 'REQUIREMENT_SATISFIED') throw new Error('Governed binding did not reach REQUIREMENT_SATISFIED.');

  const ledger = await pool.query(
    `select entry_id, entry_type, authority_type, authority_reference, amount_minor, currency
       from finance.ledger_entries
      where commercial_record_reference = $1
        and entry_type in ('FINANCE_CLEARANCE_CREATED', 'PAYMENT_REQUIREMENT_SATISFIED')
      order by entry_type`,
    [commercialRecordReference],
  );
  if (ledger.rowCount !== 2) throw new Error(`Expected exactly two binding authority ledger entries, got ${ledger.rowCount}.`);

  const clearanceEntry = ledger.rows.find((row) => row.entry_type === 'FINANCE_CLEARANCE_CREATED');
  const satisfactionEntry = ledger.rows.find((row) => row.entry_type === 'PAYMENT_REQUIREMENT_SATISFIED');
  if (!clearanceEntry || !satisfactionEntry) throw new Error('Required binding ledger entries were not found.');
  if (clearanceEntry.authority_type !== 'finance_clearance' || clearanceEntry.authority_reference !== clearanceId) {
    throw new Error('Finance clearance ledger authority mismatch.');
  }
  if (satisfactionEntry.authority_type !== 'commercial_payment_satisfaction' || satisfactionEntry.authority_reference !== requirementReference) {
    throw new Error('Commercial payment satisfaction ledger authority mismatch.');
  }
  if (Number(clearanceEntry.amount_minor) !== 12500 || clearanceEntry.currency !== 'ZAR') throw new Error('Clearance ledger amount or currency mismatch.');
  if (Number(satisfactionEntry.amount_minor) !== 12500 || satisfactionEntry.currency !== 'ZAR') throw new Error('Satisfaction ledger amount or currency mismatch.');

  let replayRejected = false;
  try {
    await runtime.governedBindingService.bind({
      commercialRecordReference,
      gate: 'PRODUCTION_START',
      provider: 'paystack',
      providerPaymentReference,
      trustedPaymentWebhookIdempotencyKey: webhookIdempotencyKey,
      clearanceId,
      executionId: `exec:binding-ledger-runtime:${suffix}:replay`,
      correlationId: `corr:binding-ledger-runtime:${suffix}:replay`,
    });
  } catch (error) {
    replayRejected = error instanceof Error && error.message.includes('requires READY_TO_BIND_REQUIREMENT');
  }
  if (!replayRejected) throw new Error('Repeat governed binding was not rejected after requirement satisfaction.');

  const replayLedger = await pool.query(
    `select entry_id, entry_type
       from finance.ledger_entries
      where commercial_record_reference = $1
        and entry_type in ('FINANCE_CLEARANCE_CREATED', 'PAYMENT_REQUIREMENT_SATISFIED')`,
    [commercialRecordReference],
  );
  if (replayLedger.rowCount !== 2) throw new Error(`Repeat binding changed immutable ledger history; found ${replayLedger.rowCount} binding entries.`);

  console.log('PASS  Governed Finance binding persists matching FINANCE_CLEARED and commercial satisfaction authorities, journals exactly one immutable ledger entry for each, and rejects repeat binding after satisfaction without duplicating or rewriting ledger history.');
  console.log(`Payment verification calls: ${verificationCalls}`);
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
