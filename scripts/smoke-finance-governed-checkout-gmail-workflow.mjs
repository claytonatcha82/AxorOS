import assert from 'node:assert/strict';
import pg from 'pg';
import { AgentRuntimeHandlerRegistry } from '../apps/api/dist/agents/agent-runtime-handlers.js';
import { createAgentRuntimeOrchestrator } from '../apps/api/dist/agents/agent-runtime-orchestrator.js';
import { createFinanceGovernedCheckoutEmailPreparationService } from '../apps/api/dist/agents/finance-governed-checkout-email-preparation-service.js';
import { createFinanceGovernedCommunicationDraftService } from '../apps/api/dist/agents/finance-governed-communication-draft-service.js';
import { createFinanceGovernedEmailPreparationService } from '../apps/api/dist/agents/finance-governed-email-preparation-service.js';
import { createFinancePaymentRuntime } from '../apps/api/dist/agents/finance-payment-runtime.js';
import { registerFinanceEmailCapabilities, FINANCE_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/finance-email-capabilities.js';
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
const paystackSecretKey = required('AXOROS_PAYSTACK_SECRET_KEY');
if (!paystackSecretKey.startsWith('sk_test_')) {
  throw new Error('Governed Finance checkout smoke requires a Paystack test secret key.');
}
const gmailClientId = required('AXOROS_GMAIL_CLIENT_ID');
const gmailClientSecret = required('AXOROS_GMAIL_CLIENT_SECRET');
const gmailRefreshToken = required('AXOROS_GMAIL_REFRESH_TOKEN');
const identitiesJson = required('AXOROS_GMAIL_IDENTITY_ADDRESSES');
let identityAddresses;
try {
  identityAddresses = JSON.parse(identitiesJson);
} catch {
  throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.');
}
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
  paystackSecretKey,
});
for (const integrationId of ['model.gemini', 'email.gmail', 'payment.paystack.request']) {
  if (!registeredIntegrationIds.includes(integrationId)) {
    throw new Error(`Required integration ${integrationId} is not registered.`);
  }
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-finance-governed-checkout-gmail-workflow',
});

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const provider = 'paystack';
const commercialRecordReference = `commercial:finance-checkout:${suffix}`;
const assessmentProviderPaymentReference = `payment:finance-checkout:assessment:${suffix}`;
const requirementReference = `deposit:${commercialRecordReference}`;
const gate = 'PRODUCTION_START';
const emailExecutionId = `finance-checkout-email-${suffix}`;
const correlationId = `corr:finance-checkout-email-${suffix}`;
let auditEventId;

const financeRuntime = createFinancePaymentRuntime({
  pool,
  integrations: registry,
  paymentIntegrationId: 'payment.paystack',
  mode: 'sandbox',
});
const communicationDraftService = createFinanceGovernedCommunicationDraftService({ integrations: registry });
const emailPreparationService = createFinanceGovernedEmailPreparationService({ communicationDraftService });
const checkoutEmailPreparationService = createFinanceGovernedCheckoutEmailPreparationService({
  paymentRequestService: financeRuntime.governedPaymentRequestService,
  emailPreparationService,
});
const runtimeStore = createAgentRuntimePostgresStore(pool);
const handlers = new AgentRuntimeHandlerRegistry();
registerFinanceEmailCapabilities(handlers, registry, { integrationId: 'email.gmail' });
const orchestrator = createAgentRuntimeOrchestrator({ store: runtimeStore, handlers });

async function cleanup() {
  await pool.query('delete from runtime.agent_events where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  await pool.query('delete from runtime.idempotency_records where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  await pool.query('delete from runtime.agent_executions where execution_id = $1', [emailExecutionId]).catch(() => undefined);
  if (auditEventId) {
    await pool.query('delete from operational.workflow_events where id = $1', [auditEventId]).catch(() => undefined);
  }
  await pool.query('delete from finance.payment_requests where requirement_reference = $1', [requirementReference]).catch(() => undefined);
  await pool.query('delete from finance.commercial_payment_satisfactions where requirement_reference = $1', [requirementReference]).catch(() => undefined);
  await pool.query('delete from finance.payment_current_state where provider = $1 and provider_payment_reference = $2', [provider, assessmentProviderPaymentReference]).catch(() => undefined);
  await pool.query('delete from finance.commercial_payment_requirements where commercial_record_reference = $1 and gate = $2', [commercialRecordReference, gate]).catch(() => undefined);
}

try {
  await financeRuntime.requirementStore.save({
    commercialRecordReference,
    gate,
    requirementReference,
    requirementType: 'DEPOSIT',
    requiredAmountMinor: 10000,
    currency: 'ZAR',
    status: 'ACTIVE',
  });

  const assessed = await financeRuntime.governedOperationalRuntime.assess({
    commercialRecordReference,
    gate,
    provider,
    providerPaymentReference: assessmentProviderPaymentReference,
  });
  assert.equal(assessed.decision.state, 'AWAITING_VERIFIED_PAYMENT');
  assert.equal(assessed.decision.clearanceId, undefined);
  assert.equal(assessed.decision.paymentEvidenceReference, undefined);
  assert.equal(assessed.auditEventReference.startsWith('workflow-event:'), true);
  auditEventId = assessed.auditEventReference.slice('workflow-event:'.length);

  const emailTask = await checkoutEmailPreparationService.prepare({
    executionId: emailExecutionId,
    correlationId,
    decision: assessed.decision,
    to: [{ email: financeAddress }],
    subject: '[AxorOS TEST] Governed Finance checkout draft - DO NOT SEND',
  });

  assert.equal(emailTask.approvalRequired, true);
  assert.equal(emailTask.approvalOwner, 'human_executive');
  assert.equal(emailTask.context.financeGovernedCommunication?.sendAuthorised, false);
  assert.equal(emailTask.context.financeGovernedCommunication?.checkoutAuthorityAppendedDeterministically, true);
  const providerPaymentReference = String(emailTask.context.financeGovernedCommunication?.providerPaymentReference ?? '');
  assert.equal(providerPaymentReference.startsWith('AXOROS-'), true);
  const textBody = String(emailTask.inputs.textBody ?? '');
  assert.match(textBody, /Secure payment link:/);
  assert.match(textBody, /https:\/\//);
  assert.match(textBody, new RegExp(`Payment reference: ${providerPaymentReference}`));

  const persistedRequest = await financeRuntime.paymentRequestStore.get(requirementReference);
  assert.ok(persistedRequest);
  assert.equal(persistedRequest.commercialRecordReference, commercialRecordReference);
  assert.equal(persistedRequest.providerPaymentReference, providerPaymentReference);
  assert.equal(persistedRequest.amountMinor, 10000);
  assert.equal(persistedRequest.currency, 'ZAR');
  assert.equal(persistedRequest.authorizationUrl.startsWith('https://'), true);

  await runtimeStore.saveExecution({ task: emailTask, version: 1, persistedAt: emailTask.createdAt }, 0);

  const beforeApproval = await orchestrator.execute({
    executionId: emailExecutionId,
    capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY,
  });
  assert.equal(beforeApproval.record.task.status, 'review');
  assert.equal(beforeApproval.record.task.approvalOwner, 'human_executive');
  assert.equal(beforeApproval.record.result?.output?.draftId, undefined);

  const approved = await orchestrator.resolveApproval({
    executionId: emailExecutionId,
    actor: 'human_executive',
    decision: 'approved',
    reason: 'Controlled synthetic Finance checkout smoke approved for Gmail draft creation only.',
  });
  assert.equal(approved.record.task.status, 'ready');
  assert.equal(approved.record.task.approvalRequired, false);

  const emailOutcome = await orchestrator.execute({
    executionId: emailExecutionId,
    capabilityId: FINANCE_EMAIL_DRAFT_CAPABILITY,
  });
  assert.equal(emailOutcome.record.task.status, 'completed');
  assert.equal(emailOutcome.record.result?.status, 'completed');
  assert.equal(emailOutcome.record.result?.output?.integrationId, 'email.gmail');
  assert.equal(emailOutcome.record.result?.output?.mode, 'draft');
  assert.ok(emailOutcome.record.result?.output?.draftId);

  const satisfaction = await financeRuntime.satisfactionStore.get(requirementReference);
  assert.equal(satisfaction, null);

  console.log('PASS governed persisted Finance requirement -> Paystack test checkout -> Gemini wording -> deterministic checkout assembly -> Human Executive approval -> Gmail draft-only workflow');
  console.log(`Deterministic state: ${assessed.decision.state}`);
  console.log(`Provider payment reference: ${providerPaymentReference}`);
  console.log(`Checkout URL persisted: ${persistedRequest.authorizationUrl}`);
  console.log(`Draft ID: ${emailOutcome.record.result.output.draftId}`);
  console.log('No Gmail draft existed before Human Executive approval.');
  console.log('No email was sent. No payment was executed. No Finance clearance or commercial payment satisfaction was created.');
  console.log('Paystack test mode and synthetic Finance identity only. Open Gmail Drafts and review the AxorOS TEST checkout draft. Do not send it.');
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
