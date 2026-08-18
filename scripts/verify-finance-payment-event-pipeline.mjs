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
  application_name: 'axoros-finance-payment-event-pipeline-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'deterministic-payment-sandbox';
const providerPaymentReference = `sandbox_paid_event_pipeline_${suffix}`;
const commercialRecordReference = `commercial:finance-payment-event-pipeline:${suffix}`;
const paidEventReference = `evt-paid:${suffix}`;
const disputeEventReference = `evt-dispute:${suffix}`;
const paidIdempotencyKey = `payment-webhook:${provider}:${paidEventReference}`;
const disputeIdempotencyKey = `payment-webhook:${provider}:${disputeEventReference}`;
const clearanceId = `finance-clearance:${provider}:${paidEventReference}`;

function envelope(eventType, providerEventReference, occurredAt) {
  return {
    provider,
    providerEventReference,
    providerPaymentReference,
    eventType,
    commercialRecordReference,
    amountMinor: 125000,
    currency: 'ZAR',
    occurredAt,
    signatureVerified: true,
  };
}

try {
  await client.connect();
  await client.query('begin');

  const integrations = new IntegrationRegistry();
  integrations.register(new DeterministicPaymentIntegration());
  const runtime = createFinancePaymentRuntime({
    pool: client,
    integrations,
    paymentIntegrationId: 'payment.sandbox',
    mode: 'sandbox',
  });

  const paidEnvelope = envelope('payment_paid', paidEventReference, '2026-08-18T18:00:00.000Z');
  const paid = await runtime.eventWorkflow.ingest(paidEnvelope);

  if (paid.webhookPersistence !== 'accepted') {
    throw new Error(`expected trusted paid webhook to persist as accepted, received ${paid.webhookPersistence}.`);
  }
  if (!paid.clearance || paid.clearance.decision.state !== 'FINANCE_CLEARED') {
    throw new Error('trusted paid webhook did not produce FINANCE_CLEARED after independent provider verification.');
  }
  if (paid.currentStatePersistence !== 'accepted') {
    throw new Error(`expected paid current state to persist as accepted, received ${paid.currentStatePersistence}.`);
  }

  const persistedWebhook = await runtime.webhookStore.get(paidIdempotencyKey);
  if (!persistedWebhook) throw new Error('trusted paid webhook evidence could not be reloaded from PostgreSQL.');
  if (persistedWebhook.evidenceReference !== `payment-provider:${provider}:${paidEventReference}`) {
    throw new Error('persisted paid webhook evidence reference is incorrect.');
  }

  const persistedClearance = await runtime.clearanceStore.get(clearanceId);
  if (!persistedClearance) throw new Error('Finance clearance could not be reloaded from PostgreSQL.');
  if (persistedClearance.state !== 'FINANCE_CLEARED') throw new Error('persisted Finance clearance is not FINANCE_CLEARED.');
  if (!persistedClearance.evidenceReferences.includes(persistedWebhook.evidenceReference)) {
    throw new Error('Finance clearance is not bound to the trusted persisted webhook evidence.');
  }
  if (!persistedClearance.evidenceReferences.some((reference) => reference.startsWith('payment-sandbox:'))) {
    throw new Error('Finance clearance does not retain independent payment verification evidence.');
  }

  const paidState = await runtime.currentStateStore.get(provider, providerPaymentReference);
  if (!paidState) throw new Error('authoritative paid current state could not be reloaded.');
  if (paidState.authorityState !== 'AUTHORIZED' || paidState.paymentStatus !== 'CONFIRMED') {
    throw new Error(`expected AUTHORIZED/CONFIRMED current state, received ${paidState.authorityState}/${paidState.paymentStatus}.`);
  }

  const replay = await runtime.eventWorkflow.ingest(paidEnvelope);
  if (replay.webhookPersistence !== 'duplicate') {
    throw new Error(`exact paid webhook replay expected duplicate persistence, received ${replay.webhookPersistence}.`);
  }
  if (!replay.clearance || replay.clearance.persistence !== 'duplicate') {
    throw new Error('exact paid webhook replay did not preserve clearance idempotency.');
  }
  if (replay.currentStatePersistence !== 'duplicate') {
    throw new Error(`exact paid webhook replay expected duplicate current state, received ${replay.currentStatePersistence}.`);
  }

  const clearanceBeforeDispute = await runtime.clearanceStore.get(clearanceId);
  if (!clearanceBeforeDispute) throw new Error('Finance clearance disappeared before dispute verification.');

  const disputed = await runtime.eventWorkflow.ingest(
    envelope('payment_disputed', disputeEventReference, '2026-08-18T18:05:00.000Z'),
  );
  if (disputed.webhookPersistence !== 'accepted') {
    throw new Error(`expected dispute webhook to persist as accepted, received ${disputed.webhookPersistence}.`);
  }
  if (disputed.clearance !== undefined) {
    throw new Error('dispute webhook incorrectly created or replaced a Finance clearance.');
  }
  if (disputed.currentStatePersistence !== 'accepted') {
    throw new Error(`expected dispute current-state update to be accepted, received ${disputed.currentStatePersistence}.`);
  }

  const disputeEvidence = await runtime.webhookStore.get(disputeIdempotencyKey);
  if (!disputeEvidence) throw new Error('trusted dispute webhook evidence could not be reloaded from PostgreSQL.');

  const disputedState = await runtime.currentStateStore.get(provider, providerPaymentReference);
  if (!disputedState) throw new Error('authoritative disputed current state could not be reloaded.');
  if (disputedState.authorityState !== 'MANUAL_REVIEW' || disputedState.paymentStatus !== 'DISPUTED') {
    throw new Error(`expected MANUAL_REVIEW/DISPUTED current state, received ${disputedState.authorityState}/${disputedState.paymentStatus}.`);
  }
  if (disputedState.latestEvidenceReference !== disputeEvidence.evidenceReference) {
    throw new Error('current payment state is not linked to the latest trusted dispute evidence.');
  }

  const clearanceAfterDispute = await runtime.clearanceStore.get(clearanceId);
  if (!clearanceAfterDispute) throw new Error('immutable Finance clearance disappeared after dispute.');
  if (JSON.stringify(clearanceAfterDispute) !== JSON.stringify(clearanceBeforeDispute)) {
    throw new Error('later dispute rewrote immutable Finance clearance evidence.');
  }

  await client.query('rollback');
  console.log('PASS  Trusted persisted payment webhook evidence drives independent verification, FINANCE_CLEARED authorization, idempotent replay, and adverse current-state revocation without rewriting immutable clearance evidence.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
