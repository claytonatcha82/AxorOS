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
  application_name: 'axoros-finance-full-ledger-lifecycle-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:full-ledger:${suffix}`;
const requirementReference = `requirement:full-ledger:${suffix}`;
const paidEventReference = `event-paid:${suffix}`;
const disputedEventReference = `event-disputed:${suffix}`;
const clearanceId = `finance-clearance:full-ledger:${suffix}`;
const paidAt = new Date().toISOString();
const disputedAt = new Date(Date.parse(paidAt) + 1000).toISOString();
let requestCalls = 0;
let verificationCalls = 0;

const integrations = new IntegrationRegistry();
integrations.register({
  integrationId: 'payment.paystack.request',
  kind: 'payment',
  provider: 'paystack',
  supportedModes: ['sandbox'],
  supportedOperations: ['initialize_payment_request'],
  async execute(request) {
    requestCalls += 1;
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
        providerEventReference: paidEventReference,
        verifiedAt: paidAt,
      },
      externalReference: input.providerPaymentReference,
      evidenceReferences: [`payment-sandbox:${paidEventReference}`],
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

async function ledgerRows() {
  const result = await pool.query(
    `select entry_id, entry_type, authority_type, authority_reference, amount_minor, currency
       from finance.ledger_entries
      where commercial_record_reference = $1`,
    [commercialRecordReference],
  );
  return result.rows;
}

async function cleanup() {
  await pool.query('delete from finance.ledger_entries where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.commercial_payment_satisfactions where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.clearance_decisions where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.payment_current_state where commercial_record_reference = $1', [commercialRecordReference]);
  await pool.query('delete from finance.payment_webhook_events where commercial_record_reference = $1', [commercialRecordReference]);
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
  if (requirementPersistence !== 'accepted') throw new Error('Requirement was not newly accepted.');

  const checkout = await runtime.governedPaymentRequestService.initialize({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    recipientEmail: 'synthetic-client@example.com',
    executionId: `exec:full-ledger:${suffix}:checkout`,
    correlationId: `corr:full-ledger:${suffix}:checkout`,
  });
  if (checkout.replayed !== false || requestCalls !== 1) throw new Error('Governed checkout creation did not execute exactly once.');

  const paymentRequest = await runtime.paymentRequestStore.get(requirementReference);
  if (!paymentRequest) throw new Error('Persisted payment request was not found.');
  const providerPaymentReference = paymentRequest.providerPaymentReference;

  const paid = await runtime.eventWorkflow.ingest({
    provider: 'paystack',
    providerEventReference: paidEventReference,
    providerPaymentReference,
    eventType: 'payment_paid',
    commercialRecordReference,
    amountMinor: 12500,
    currency: 'ZAR',
    occurredAt: paidAt,
    signatureVerified: true,
  });
  if (paid.webhookPersistence !== 'accepted') throw new Error('Trusted paid provider evidence was not accepted.');

  const before = await runtime.governedOperationalCoordinator.assess({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    provider: 'paystack',
    providerPaymentReference,
  });
  if (before.state !== 'READY_TO_BIND_REQUIREMENT') throw new Error(`Expected READY_TO_BIND_REQUIREMENT, received ${before.state}.`);

  const bound = await runtime.governedBindingService.bind({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    provider: 'paystack',
    providerPaymentReference,
    trustedPaymentWebhookIdempotencyKey: `payment-webhook:paystack:${paidEventReference}`,
    clearanceId,
    executionId: `exec:full-ledger:${suffix}:bind`,
    correlationId: `corr:full-ledger:${suffix}:bind`,
  });
  if (bound.after.state !== 'REQUIREMENT_SATISFIED') throw new Error('Governed binding did not reach REQUIREMENT_SATISFIED.');

  const disputed = await runtime.eventWorkflow.ingest({
    provider: 'paystack',
    providerEventReference: disputedEventReference,
    providerPaymentReference,
    eventType: 'payment_disputed',
    commercialRecordReference,
    amountMinor: 12500,
    currency: 'ZAR',
    occurredAt: disputedAt,
    signatureVerified: true,
  });
  if (disputed.webhookPersistence !== 'accepted') throw new Error('Adverse provider evidence was not accepted.');

  const rows = await ledgerRows();
  const expectedTypes = [
    'PAYMENT_REQUIREMENT_CREATED',
    'PAYMENT_REQUEST_CREATED',
    'PAYMENT_PROVIDER_STATE_OBSERVED',
    'FINANCE_CLEARANCE_CREATED',
    'PAYMENT_REQUIREMENT_SATISFIED',
    'PAYMENT_ADVERSE_EVENT_OBSERVED',
  ];
  if (rows.length !== expectedTypes.length) {
    throw new Error(`Expected ${expectedTypes.length} immutable lifecycle ledger entries, got ${rows.length}.`);
  }
  for (const entryType of expectedTypes) {
    const matches = rows.filter((row) => row.entry_type === entryType);
    if (matches.length !== 1) throw new Error(`Expected exactly one ${entryType} ledger entry, got ${matches.length}.`);
    if (Number(matches[0].amount_minor) !== 12500 || matches[0].currency !== 'ZAR') {
      throw new Error(`${entryType} ledger amount or currency mismatch.`);
    }
  }

  const adverse = rows.find((row) => row.entry_type === 'PAYMENT_ADVERSE_EVENT_OBSERVED');
  if (adverse.authority_reference !== `payment-provider:paystack:${disputedEventReference}`) {
    throw new Error('Adverse lifecycle ledger authority mismatch.');
  }

  console.log('PASS  Full governed Finance lifecycle journals exactly one immutable authority for requirement creation, checkout creation, trusted paid provider state, Finance clearance, commercial satisfaction, and later adverse provider evidence without rewriting prior history.');
  console.log(`Payment request calls: ${requestCalls}`);
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
