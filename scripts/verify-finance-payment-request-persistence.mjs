import pg from 'pg';
import { CommercialPaymentRequirementPostgresStore } from '../apps/api/dist/data/commercial-payment-requirement-postgres-store.js';
import { FinancePaymentRequestPostgresStore } from '../apps/api/dist/data/finance-payment-request-postgres-store.js';
import { createFinanceGovernedPaymentRequestService } from '../apps/api/dist/agents/finance-governed-payment-request-service.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-payment-request-persistence-verify',
});

const requirementStore = new CommercialPaymentRequirementPostgresStore(pool);
const paymentRequestStore = new FinancePaymentRequestPostgresStore(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:payment-request:${suffix}`;
const requirementReference = `requirement:payment-request:${suffix}`;
let providerCalls = 0;

const integrations = {
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
};

const service = createFinanceGovernedPaymentRequestService({
  requirementStore,
  paymentRequestStore,
  integrations,
  mode: 'sandbox',
});

async function cleanup() {
  await pool.query('delete from finance.payment_requests where requirement_reference = $1', [requirementReference]);
  await pool.query(
    'delete from finance.commercial_payment_requirements where commercial_record_reference = $1',
    [commercialRecordReference],
  );
}

try {
  const requirementPersistence = await requirementStore.save({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 12500,
    currency: 'ZAR',
    status: 'ACTIVE',
  });
  if (requirementPersistence !== 'accepted') {
    throw new Error('Commercial payment requirement was not newly accepted.');
  }

  const first = await service.initialize({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    recipientEmail: 'synthetic-client@example.com',
    executionId: `exec:payment-request:${suffix}:1`,
    correlationId: `corr:payment-request:${suffix}:1`,
  });
  if (first.replayed !== false) throw new Error('Initial payment request was incorrectly marked as replayed.');
  if (!first.accessCode) throw new Error('Initial provider response did not expose its transient access code.');
  if (providerCalls !== 1) throw new Error(`Expected exactly one provider call after initial request, got ${providerCalls}.`);

  const persisted = await paymentRequestStore.get(requirementReference);
  if (!persisted) throw new Error('Finance payment request was not persisted.');
  if (persisted.commercialRecordReference !== commercialRecordReference) throw new Error('Persisted commercial reference mismatch.');
  if (persisted.provider !== 'paystack') throw new Error('Persisted payment provider mismatch.');
  if (persisted.providerPaymentReference !== first.providerPaymentReference) throw new Error('Persisted provider payment reference mismatch.');
  if (persisted.authorizationUrl !== first.authorizationUrl) throw new Error('Persisted authorization URL mismatch.');
  if (persisted.amountMinor !== 12500 || persisted.currency !== 'ZAR') throw new Error('Persisted amount or currency mismatch.');
  if (!persisted.evidenceReferences.includes(`payment-paystack-request:${first.providerPaymentReference}`)) {
    throw new Error('Persisted payment-request evidence is missing.');
  }

  const replay = await service.initialize({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    recipientEmail: 'different-recipient@example.com',
    executionId: `exec:payment-request:${suffix}:2`,
    correlationId: `corr:payment-request:${suffix}:2`,
  });
  if (replay.replayed !== true) throw new Error('Persisted payment request replay was not identified.');
  if (replay.accessCode !== undefined) throw new Error('Transient provider access code leaked into persisted replay.');
  if (replay.providerPaymentReference !== first.providerPaymentReference) throw new Error('Replay provider reference changed.');
  if (replay.authorizationUrl !== first.authorizationUrl) throw new Error('Replay authorization URL changed.');
  if (providerCalls !== 1) throw new Error(`Replay incorrectly called the provider; total calls ${providerCalls}.`);

  console.log('PASS  Governed Finance payment request persists provider checkout authority once, replays it idempotently without a second provider call, and does not persist transient Paystack access-code authority.');
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
