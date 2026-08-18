import pg from 'pg';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { DeterministicPaymentIntegration } from '../apps/api/dist/integrations/deterministic-payment-integration.js';
import { IntegrationRegistry } from '../apps/api/dist/integrations/integration-registry.js';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({
  connectionString,
  application_name: 'axoros-finance-payment-runtime-verify',
});
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const commercialRecordReference = `commercial:finance-payment-runtime:${suffix}`;
const paidClearanceId = `finance-clearance:paid:${suffix}`;
const pendingClearanceId = `finance-clearance:pending:${suffix}`;

try {
  await client.connect();
  await client.query('begin');

  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicPaymentIntegration());
  const runtime = createFinancePaymentRuntime({ pool: client, integrations });

  const paid = await runtime.workflow.verifyAndPersist({
    clearanceId: paidClearanceId,
    executionId: `exec-finance-payment-paid:${suffix}`,
    correlationId: `corr-finance-payment-paid:${suffix}`,
    paymentIntegrationId: 'payment.sandbox',
    mode: 'sandbox',
    expected: {
      providerPaymentReference: `sandbox_paid_${suffix}`,
      expectedAmountMinor: 125000,
      currency: 'ZAR',
      commercialRecordReference,
    },
  });

  if (paid.persistence !== 'accepted') {
    throw new Error(`expected paid Finance decision persistence to be accepted, received ${paid.persistence}.`);
  }
  if (paid.decision.state !== 'FINANCE_CLEARED') {
    throw new Error(`expected paid sandbox verification to produce FINANCE_CLEARED, received ${paid.decision.state}.`);
  }

  const persistedPaid = await runtime.clearanceStore.get(paidClearanceId);
  if (!persistedPaid) throw new Error('persisted paid Finance clearance could not be reloaded.');
  if (persistedPaid.state !== 'FINANCE_CLEARED') throw new Error('persisted paid Finance clearance is not FINANCE_CLEARED.');
  if (persistedPaid.commercialRecordReference !== commercialRecordReference) {
    throw new Error('persisted paid Finance clearance does not match the governed commercial record.');
  }
  if (persistedPaid.amountMinor !== 125000 || persistedPaid.currency !== 'ZAR') {
    throw new Error('persisted paid Finance clearance amount or currency is incorrect.');
  }
  if (persistedPaid.evidenceReferences.length === 0) {
    throw new Error('persisted paid Finance clearance has no provider evidence.');
  }

  const pending = await runtime.workflow.verifyAndPersist({
    clearanceId: pendingClearanceId,
    executionId: `exec-finance-payment-pending:${suffix}`,
    correlationId: `corr-finance-payment-pending:${suffix}`,
    paymentIntegrationId: 'payment.sandbox',
    mode: 'sandbox',
    expected: {
      providerPaymentReference: `sandbox_pending_${suffix}`,
      expectedAmountMinor: 125000,
      currency: 'ZAR',
      commercialRecordReference,
    },
  });

  if (pending.persistence !== 'accepted') {
    throw new Error(`expected pending Finance decision persistence to be accepted, received ${pending.persistence}.`);
  }
  if (pending.decision.state !== 'FINANCE_PENDING') {
    throw new Error(`expected pending sandbox verification to remain FINANCE_PENDING, received ${pending.decision.state}.`);
  }

  const persistedPending = await runtime.clearanceStore.get(pendingClearanceId);
  if (!persistedPending) throw new Error('persisted pending Finance decision could not be reloaded.');
  if (persistedPending.state !== 'FINANCE_PENDING') {
    throw new Error('pending payment evidence incorrectly produced persisted Finance clearance.');
  }

  await client.query('rollback');
  console.log('PASS  Sandbox payment verification persists authoritative FINANCE_CLEARED evidence and keeps unverified payment FINANCE_PENDING.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
