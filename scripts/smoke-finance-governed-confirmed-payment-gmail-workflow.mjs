import pg from 'pg';
import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { registerFinanceEmailCapabilities, FINANCE_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/finance-email-capabilities.js';
import { createFinanceGovernedCommunicationDraftService } from '../apps/api/dist/agents/finance-governed-communication-draft-service.js';
import { createFinanceGovernedEmailPreparationService } from '../apps/api/dist/agents/finance-governed-email-preparation-service.js';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { createAgentRuntimePostgresStore } from '../apps/api/dist/data/agent-runtime-postgres-store.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';

const { Pool } = pg;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required via Infisical.`);
  return value;
};

const connectionString = required('AXOROS_DATABASE_URL');
const geminiApiKey = required('GEMINI_API_KEY');
const gmailClientId = required('AXOROS_GMAIL_CLIENT_ID');
const gmailClientSecret = required('AXOROS_GMAIL_CLIENT_SECRET');
const gmailRefreshToken = required('AXOROS_GMAIL_REFRESH_TOKEN');
const identitiesJson = required('AXOROS_GMAIL_IDENTITY_ADDRESSES');
let identityAddresses;
try { identityAddresses = JSON.parse(identitiesJson); } catch { throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.'); }
const financeAddress = typeof identityAddresses?.finance === 'string' ? identityAddresses.finance.trim() : '';
if (!financeAddress) throw new Error('A finance Gmail identity is required.');

const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry({
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  geminiApiKey,
  ...(process.env.AXOROS_GEMINI_MODEL?.trim() ? { geminiModel: process.env.AXOROS_GEMINI_MODEL.trim() } : {}),
  gmailClientId,
  gmailClientSecret,
  gmailRefreshToken,
  gmailIdentityAddresses: identityAddresses,
});
if (!registeredIntegrationIds.includes('model.gemini') || !registeredIntegrationIds.includes('email.gmail') || !registeredIntegrationIds.includes('payment.sandbox')) {
  throw new Error('Gemini, Gmail, and sandbox payment integrations must be registered.');
}

const pool = new Pool({ connectionString, max: 2, application_name: 'axoros-finance-governed-confirmed-payment-gmail-smoke' });
const runtime = createFinancePaymentRuntime({ pool, integrations: registry, paymentIntegrationId: 'payment.sandbox', mode: 'sandbox' });
const communicationDraftService = createFinanceGovernedCommunicationDraftService({ integrations: registry });
const emailPreparationService = createFinanceGovernedEmailPreparationService({ communicationDraftService });
const handlers = new AgentRuntimeHandlerRegistry();
registerFinanceEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });
const store = createAgentRuntimePostgresStore(pool);
const orchestrator = createAgentRuntimeOrchestrator({ store, handlers });

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'deterministic-webhook-sandbox';
const commercialRecordReference = `commercial:finance-confirmed-communication:${suffix}`;
const requirementReference = `requirement:finance-confirmed-communication:${suffix}`;
const providerPaymentReference = `sandbox_paid_${suffix}`;
const providerEventReference = `event:paid:${suffix}`;
const paymentEvidenceReference = `payment-provider:${provider}:${providerEventReference}`;
const clearanceId = `finance-clearance:confirmed-communication:${suffix}`;
const emailExecutionId = `finance-confirmed-email-${suffix}`;
const amountMinor = 10000;
const currency = 'ZAR';
const occurredAt = new Date().toISOString();
const paymentEvidence = {
  idempotencyKey: `payment-webhook:${provider}:${providerEventReference}`,
  provider,
  providerEventReference,
  providerPaymentReference,
  eventType: 'payment_paid',
  commercialRecordReference,
  amountMinor,
  currency,
  occurredAt,
  evidenceReference: paymentEvidenceReference,
};

async function cleanup() {
  await pool.query('delete from runtime.agent_events where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  await pool.query('delete from runtime.idempotency_records where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  await pool.query('delete from runtime.agent_executions where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  await pool.query('delete from finance.commercial_payment_satisfactions where requirement_reference = $1', [requirementReference]).catch(() => undefined);
  await pool.query('delete from finance.clearance_decisions where clearance_id = $1', [clearanceId]).catch(() => undefined);
  await pool.query('delete from finance.payment_current_state where provider = $1 and provider_payment_reference = $2', [provider, providerPaymentReference]).catch(() => undefined);
  await pool.query('delete from finance.payment_webhook_events where idempotency_key = $1', [paymentEvidence.idempotencyKey]).catch(() => undefined);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1', [commercialRecordReference]).catch(() => undefined);
}

try {
  await runtime.requirementStore.save({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: amountMinor,
    currency,
    status: 'ACTIVE',
  });
  await runtime.webhookStore.save(paymentEvidence);
  await runtime.currentStateStore.apply(paymentEvidence);

  const before = await runtime.governedOperationalCoordinator.assess({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    provider,
    providerPaymentReference,
  });
  if (before.state !== 'READY_TO_BIND_REQUIREMENT') {
    throw new Error(`Expected READY_TO_BIND_REQUIREMENT before binding, received ${before.state}.`);
  }

  let prematureBlocked = false;
  try {
    await communicationDraftService.draft({
      executionId: `model:premature:${suffix}`,
      correlationId: `corr:${suffix}`,
      decision: before,
    });
  } catch (error) {
    prematureBlocked = error instanceof Error && error.message.includes('does not permit client-facing model drafting');
  }
  if (!prematureBlocked) {
    throw new Error('Finance confirmation drafting was not blocked before commercial requirement satisfaction.');
  }

  const bound = await runtime.governedBindingService.bind({
    commercialRecordReference,
    gate: 'PRODUCTION_START',
    provider,
    providerPaymentReference,
    trustedPaymentWebhookIdempotencyKey: paymentEvidence.idempotencyKey,
    clearanceId,
    executionId: `exec:finance-confirmed-binding:${suffix}`,
    correlationId: `corr:${suffix}`,
  });
  if (bound.after.state !== 'REQUIREMENT_SATISFIED' || bound.after.clearanceId !== clearanceId) {
    throw new Error('Governed binding did not produce matching REQUIREMENT_SATISFIED Finance state.');
  }

  const emailTask = await emailPreparationService.prepare({
    executionId: emailExecutionId,
    correlationId: `corr:${suffix}`,
    decision: bound.after,
    to: [{ email: financeAddress }],
    subject: '[AxorOS TEST] Governed confirmed payment draft - DO NOT SEND',
    fromIdentity: 'finance',
  });
  const governedContext = emailTask.context?.financeGovernedCommunication;
  if (!governedContext || governedContext.operationalState !== 'REQUIREMENT_SATISFIED' || governedContext.intent !== 'DRAFT_PAYMENT_CONFIRMATION') {
    throw new Error('Prepared email task does not preserve confirmed governed Finance communication state.');
  }
  if (!emailTask.approvalRequired || emailTask.approvalOwner !== 'human_executive') {
    throw new Error('Confirmed-payment Finance email did not require Human Executive approval.');
  }
  await store.saveExecution({ task: emailTask, version: 1, persistedAt: new Date().toISOString() }, 0);

  const review = await orchestrator.execute({ executionId: emailExecutionId, capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY });
  if (review.record.task.status !== 'review' || review.record.result?.output?.draftId) {
    throw new Error('Finance confirmed-payment Gmail path did not stop before draft creation for Human Executive approval.');
  }

  await orchestrator.resolveApproval({
    executionId: emailExecutionId,
    actor: 'human_executive',
    decision: 'approved',
    reason: 'Controlled synthetic confirmed-payment Finance communication smoke approved for Gmail draft creation only.',
  });
  const outcome = await orchestrator.execute({ executionId: emailExecutionId, capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY });
  const draftId = outcome.record.result?.output?.draftId;
  if (outcome.record.task.status !== 'completed' || typeof draftId !== 'string' || !draftId.trim()) {
    throw new Error('Approved confirmed-payment Finance workflow did not create a Gmail draft.');
  }

  const persistedClearance = await runtime.clearanceStore.get(clearanceId);
  const persistedSatisfaction = await runtime.satisfactionStore.get(requirementReference);
  if (!persistedClearance || persistedClearance.state !== 'FINANCE_CLEARED') {
    throw new Error('Expected immutable FINANCE_CLEARED evidence to remain persisted.');
  }
  if (!persistedSatisfaction || persistedSatisfaction.clearanceId !== clearanceId) {
    throw new Error('Expected matching commercial payment satisfaction to remain persisted.');
  }

  console.log('PASS governed verified payment -> Finance binding -> confirmed communication policy -> Human Executive approval -> Gmail draft-only workflow');
  console.log(`Deterministic state before binding: ${before.state}`);
  console.log(`Deterministic state after binding: ${bound.after.state}`);
  console.log(`Clearance: ${clearanceId}`);
  console.log(`Draft ID: ${draftId}`);
  console.log('Payment confirmation drafting was blocked before governed binding and allowed only after matching immutable Finance satisfaction existed.');
  console.log('No email was sent. Synthetic data only. Open Gmail Drafts and review the AxorOS TEST Finance draft. Do not send it.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    console.error(`WARN  cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  await pool.end().catch(() => undefined);
}
