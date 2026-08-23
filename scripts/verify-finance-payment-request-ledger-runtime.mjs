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
  application_name: 'axoros-finance-payment-request-ledger-runtime-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:ledger-runtime:${suffix}`;
const requirementReference = `requirement:ledger-runtime:${suffix}`;
let providerCalls = 0;

const integrations = new IntegrationRegistry();
integrations.register({
  integrationId: 'payment.paystack.request',
  kind: 'payment',
  provider: 'paystack',
  supportedModes: ['sandbox'],
  supportedOperations: ['initialize_payment_request'],
  async execute(request) {
    providerCalls += 1;
    const input = request.input;
    return {
      integrationId: 'payment.paystack.request',
      operation: request.operation,
      provider: 'paystack',
      mode: request.mode,
      status: 'succeeded',
      output: {
        commercialRecordReference: input.commercialRecordReference,
        requirementReference: input.requirementReference,
        providerPaymentReference: input.providerPaymentReference,
        authorizationUrl: `https://checkout.paystack.test/${input.providerPaymentReference}`,
        accessCode: `access_${suffix}`,
      },
      externalReference: input.providerPaymentReference,
      evidenceReferences: [`payment-paystack-request:${input.providerPaymentReference}`],
      retryable: false,
    };
  },
});

const runtime = createFinancePaymentRuntime({
  pool,
  integrations,
  mode: 'sandbox',
});

async function cleanup() {
  await pool.query('delete from finance.ledger_entries where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.payment_requests where requirement_reference = $1', [requirementReference]);
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

  const first = await runtime.governedPaymentRequestService.initialize({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    recipientEmail: 'synthetic-client@example.com',
    executionId: `exec:ledger-runtime:${suffix}:1`,
    correlationId: `corr:ledger-runtime:${suffix}:1`,
  });
  if (first.replayed !== false) throw new Error('Initial governed checkout was incorrectly marked as replayed.');
  if (providerCalls !== 1) throw new Error(`Expected one provider call after initial checkout, got ${providerCalls}.`);

  const firstLedger = await pool.query(
    `select entry_id, entry_type, commercial_record_reference, authority_type, authority_reference,
            evidence_references, amount_minor, currency, occurred_at, recorded_at
       from finance.ledger_entries
      where commercial_record_reference = $1 and entry_type = 'PAYMENT_REQUEST_CREATED'`,
    [commercialRecordReference],
  );
  if (firstLedger.rowCount !== 1) throw new Error(`Expected exactly one PAYMENT_REQUEST_CREATED ledger entry, got ${firstLedger.rowCount}.`);
  const firstEntry = firstLedger.rows[0];
  if (firstEntry.authority_type !== 'finance_payment_request') throw new Error('Ledger authority type mismatch.');
  if (firstEntry.authority_reference !== requirementReference) throw new Error('Ledger authority reference mismatch.');
  if (Number(firstEntry.amount_minor) !== 12500 || firstEntry.currency !== 'ZAR') throw new Error('Ledger amount or currency mismatch.');

  const replay = await runtime.governedPaymentRequestService.initialize({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    recipientEmail: 'different-recipient@example.com',
    executionId: `exec:ledger-runtime:${suffix}:2`,
    correlationId: `corr:ledger-runtime:${suffix}:2`,
  });
  if (replay.replayed !== true) throw new Error('Governed checkout replay was not identified.');
  if (providerCalls !== 1) throw new Error(`Replay incorrectly called provider; total provider calls ${providerCalls}.`);

  const replayLedger = await pool.query(
    `select entry_id, entry_type, commercial_record_reference, authority_type, authority_reference,
            evidence_references, amount_minor, currency, occurred_at, recorded_at
       from finance.ledger_entries
      where commercial_record_reference = $1 and entry_type = 'PAYMENT_REQUEST_CREATED'`,
    [commercialRecordReference],
  );
  if (replayLedger.rowCount !== 1) throw new Error(`Replay created duplicate ledger history; found ${replayLedger.rowCount} entries.`);
  if (replayLedger.rows[0].entry_id !== firstEntry.entry_id) throw new Error('Replay changed immutable Finance ledger identity.');

  console.log('PASS  Governed Finance runtime creates one persisted checkout authority and exactly one immutable PAYMENT_REQUEST_CREATED ledger entry; replay reuses both without a second provider call or duplicate ledger history.');
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
