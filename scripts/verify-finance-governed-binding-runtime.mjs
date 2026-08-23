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
  application_name: 'axoros-finance-governed-binding-runtime-verify',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'deterministic-webhook-sandbox';
const amountMinor = 12500;
const currency = 'ZAR';

function evidence({ commercialRecordReference, providerPaymentReference, eventType, label, occurredAt }) {
  return {
    idempotencyKey: `payment-webhook:${provider}:${label}:${suffix}`,
    provider,
    providerEventReference: `event:${label}:${suffix}`,
    providerPaymentReference,
    eventType,
    commercialRecordReference,
    amountMinor,
    currency,
    occurredAt,
    evidenceReference: `payment-provider:${provider}:event:${label}:${suffix}`,
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

  const pendingCommercialRecordReference = `commercial:finance-governed-binding:${suffix}:pending`;
  const pendingRequirementReference = `requirement:finance-governed-binding:${suffix}:pending`;
  const pendingPaymentReference = `sandbox_pending_${suffix}`;
  const pendingEvidence = evidence({
    commercialRecordReference: pendingCommercialRecordReference,
    providerPaymentReference: pendingPaymentReference,
    eventType: 'payment_pending',
    label: 'pending',
    occurredAt: new Date().toISOString(),
  });

  await runtime.requirementStore.save({
    commercialRecordReference: pendingCommercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference: pendingRequirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: amountMinor,
    currency,
    status: 'ACTIVE',
  });
  await runtime.webhookStore.save(pendingEvidence);
  await runtime.currentStateStore.apply(pendingEvidence);

  const pendingDecision = await runtime.governedOperationalCoordinator.assess({
    commercialRecordReference: pendingCommercialRecordReference,
    gate: 'PRODUCTION_START',
    provider,
    providerPaymentReference: pendingPaymentReference,
  });
  if (pendingDecision.state !== 'PAYMENT_BLOCKED') {
    throw new Error(`Expected pending payment to be PAYMENT_BLOCKED, received ${pendingDecision.state}.`);
  }

  let pendingBlocked = false;
  try {
    await runtime.governedBindingService.bind({
      commercialRecordReference: pendingCommercialRecordReference,
      gate: 'PRODUCTION_START',
      provider,
      providerPaymentReference: pendingPaymentReference,
      trustedPaymentWebhookIdempotencyKey: pendingEvidence.idempotencyKey,
      clearanceId: `finance-clearance:governed-binding:${suffix}:pending`,
      executionId: `exec:finance-governed-binding:${suffix}:pending`,
      correlationId: `corr:finance-governed-binding:${suffix}:pending`,
    });
  } catch (error) {
    pendingBlocked = error instanceof Error && error.message.includes('READY_TO_BIND_REQUIREMENT');
  }
  if (!pendingBlocked) {
    throw new Error('Unverified payment was not blocked before governed binding.');
  }
  const pendingSatisfaction = await runtime.satisfactionStore.get(pendingRequirementReference);
  if (pendingSatisfaction) {
    throw new Error('Unverified payment incorrectly created commercial payment satisfaction.');
  }

  const paidCommercialRecordReference = `commercial:finance-governed-binding:${suffix}:paid`;
  const paidRequirementReference = `requirement:finance-governed-binding:${suffix}:paid`;
  const paidPaymentReference = `sandbox_paid_${suffix}`;
  const paidEvidence = evidence({
    commercialRecordReference: paidCommercialRecordReference,
    providerPaymentReference: paidPaymentReference,
    eventType: 'payment_paid',
    label: 'paid',
    occurredAt: new Date(Date.now() + 1000).toISOString(),
  });

  await runtime.requirementStore.save({
    commercialRecordReference: paidCommercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference: paidRequirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: amountMinor,
    currency,
    status: 'ACTIVE',
  });
  await runtime.webhookStore.save(paidEvidence);
  await runtime.currentStateStore.apply(paidEvidence);

  const before = await runtime.governedOperationalCoordinator.assess({
    commercialRecordReference: paidCommercialRecordReference,
    gate: 'PRODUCTION_START',
    provider,
    providerPaymentReference: paidPaymentReference,
  });
  if (before.state !== 'READY_TO_BIND_REQUIREMENT') {
    throw new Error(`Expected verified payment to reach READY_TO_BIND_REQUIREMENT, received ${before.state}.`);
  }

  const clearanceId = `finance-clearance:governed-binding:${suffix}:paid`;
  const bound = await runtime.governedBindingService.bind({
    commercialRecordReference: paidCommercialRecordReference,
    gate: 'PRODUCTION_START',
    provider,
    providerPaymentReference: paidPaymentReference,
    trustedPaymentWebhookIdempotencyKey: paidEvidence.idempotencyKey,
    clearanceId,
    executionId: `exec:finance-governed-binding:${suffix}:paid`,
    correlationId: `corr:finance-governed-binding:${suffix}:paid`,
  });

  if (bound.before.state !== 'READY_TO_BIND_REQUIREMENT') {
    throw new Error('Governed binding did not start from READY_TO_BIND_REQUIREMENT.');
  }
  if (bound.binding.clearance.decision.state !== 'FINANCE_CLEARED') {
    throw new Error('Governed binding did not persist FINANCE_CLEARED authority.');
  }
  if (bound.binding.satisfactionPersistence !== 'accepted') {
    throw new Error(`Expected newly accepted satisfaction, received ${bound.binding.satisfactionPersistence}.`);
  }
  if (bound.after.state !== 'REQUIREMENT_SATISFIED') {
    throw new Error(`Expected REQUIREMENT_SATISFIED after binding, received ${bound.after.state}.`);
  }

  const persistedSatisfaction = await runtime.satisfactionStore.get(paidRequirementReference);
  if (!persistedSatisfaction || persistedSatisfaction.clearanceId !== clearanceId) {
    throw new Error('Persisted commercial payment satisfaction is missing or bound to the wrong Finance clearance.');
  }
  const persistedClearance = await runtime.clearanceStore.get(clearanceId);
  if (!persistedClearance || persistedClearance.state !== 'FINANCE_CLEARED') {
    throw new Error('Persisted Finance clearance is missing after governed binding.');
  }

  await client.query('rollback');
  console.log('PASS  Governed Finance binding fails closed for unverified payment and moves verified persisted payment evidence from READY_TO_BIND_REQUIREMENT to REQUIREMENT_SATISFIED with matching immutable Finance clearance.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
